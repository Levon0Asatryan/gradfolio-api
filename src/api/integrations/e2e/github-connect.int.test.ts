import { createConnection } from 'mysql2/promise';
import type request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { adminDatabaseUrl, testDatabaseUrl } from '../../../testing/database.js';
import type { FakeAuth0 } from '../../../testing/fake-auth0.js';
import type { FakeGithub } from '../../../testing/fake-github.js';
import { createUser } from '../../../testing/factories.js';
import {
  ageReservation,
  githubConnectHarness,
  githubRow,
  sha256,
  type Http,
  SPA_CLIENT_ID,
  type Student,
  verifiedOf,
} from '../../../testing/github-connect.js';
import { b64url, type TestTenant } from '../../../testing/jwks.js';
import { db } from '../../../testing/team.js';

/**
 * M7 PR (a): GitHub connect, link, disconnect and the integrations card against
 * MySQL 8.4, with Auth0's Management API and GitHub as fakes over real HTTP
 * (docs/m7-plan.md §2.3, §4.4, §10). Every external answer comes through the
 * real transport; races are forced with barriers, never sleeps. Ownership: no
 * route takes an id; each test that involves two students checks the second
 * sees and changes nothing of the first's.
 */

const h = githubConnectHarness();
let tenant: TestTenant;
let auth0: FakeAuth0;
let gh: FakeGithub;
beforeAll(() => {
  ({ tenant, auth0, gh } = h);
});
const { logs } = h;
const start = (env?: NodeJS.ProcessEnv) => h.start(env);
const student = h.student.bind(h);
const linkedAtAuth0 = h.linkedAtAuth0.bind(h);
const githubKnows = h.githubKnows.bind(h);
const idToken = h.idToken.bind(h);
const nonceFor = h.nonceFor.bind(h);
const GITHUB_ENV = () => h.env();

describe('not configured (D9)', () => {
  it('reports GitHub as unavailable, and every GitHub route answers 503', async () => {
    const http = await start({});
    const ani = await student('auth0|ani');
    const res = await http.get('/v1/me/integrations').set(ani.auth).expect(200);
    expect(res.body).toEqual({
      github: { available: false, status: 'not_connected', login: null, lastSyncedAt: null },
      linkedin: { status: 'not_connected', lastSyncedAt: null },
    });
    for (const call of [
      http.post('/v1/me/integrations/github/connect').set(ani.auth),
      http.post('/v1/me/integrations/github/link').set(ani.auth).send({ idToken: 'x.y.z' }),
      http.delete('/v1/me/integrations/github').set(ani.auth),
    ]) {
      const r = await call;
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('INTEGRATION_UNAVAILABLE');
    }
    expect(auth0.calls).toEqual([]);
  });
});

describe('connect', () => {
  it('a GitHub-login student is connected at once; the row holds the GitHub id and login, never a token', async () => {
    const http = await start();
    const s = await student('github|583231');
    linkedAtAuth0(s.sub, '583231', 'ani-p');

    const res = await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
    expect(res.body).toEqual({ state: 'connected', login: 'ani-p' });

    expect(await githubRow(s.id)).toMatchObject({
      status: 'connected',
      externalUserId: '583231',
      externalLogin: 'ani-p',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
    });
    // GitHub confirmed the token Auth0 holds.
    expect(gh.requests.map((r) => `${r.method} ${r.path} ${r.authorization}`)).toEqual([
      `GET /user Bearer ${auth0.githubTokenFor('583231')}`,
    ]);
    // Connected GitHub counts toward verified (D5).
    expect(await verifiedOf(s.id)).toBe(true);

    const card = await http.get('/v1/me/integrations').set(s.auth).expect(200);
    expect(card.body.github).toEqual({
      available: true,
      status: 'connected',
      login: 'ani-p',
      lastSyncedAt: null,
    });
  });

  it('a student with no GitHub identity gets a link nonce; only its SHA-256 is stored', async () => {
    const http = await start();
    const s = await student('auth0|email-only');
    const before = Date.now();
    const res = await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);

    expect(res.body.state).toBe('link_required');
    expect(res.body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expiresAt = Date.parse(res.body.expiresAt as string);
    expect(expiresAt).toBeGreaterThan(before + 595_000);
    expect(expiresAt).toBeLessThanOrEqual(before + 600_000);

    const stored = await db.selectFrom('integrationNonces').selectAll().execute();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.hash).toBe(sha256(res.body.nonce as string));
    expect(stored[0]!.userId).toBe(s.id);
    expect(JSON.stringify(stored)).not.toContain(res.body.nonce);
    expect(await githubRow(s.id)).toBeUndefined();
  });

  it('a flag whose identity is gone at Auth0 is cleared, and a link nonce issued', async () => {
    const http = await start();
    const s = await student('auth0|stale-flag');
    await db
      .insertInto('integrations')
      .values({
        id: newId(),
        userId: s.id,
        integrationType: 'github',
        status: 'connected',
        externalUserId: '584',
        externalLogin: 'gone',
      })
      .execute();
    await db.updateTable('users').set({ verified: true }).where('id', '=', s.id).execute();

    const res = await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
    expect(res.body.state).toBe('link_required');
    expect(await githubRow(s.id)).toMatchObject({
      status: 'not_connected',
      externalUserId: null,
      externalLogin: null,
    });
    expect(await verifiedOf(s.id)).toBe(false);
  });

  it('a token GitHub refuses is 409 GITHUB_NOT_LINKED, and the cached token is dropped', async () => {
    const http = await start();
    const s = await student('github|9001');
    auth0.withGithub(s.sub, '9001'); // GitHub does not know the token: revoked there.

    const res = await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(409);
    expect(res.body.code).toBe('GITHUB_NOT_LINKED');
    await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(409);
    // Without the drop, the second attempt would reuse the cached token.
    expect(auth0.callsTo('/api/v2/users/')).toHaveLength(2);
    expect(await githubRow(s.id)).toBeUndefined();
  });

  it('Auth0 over its rate limit is 503 with Retry-After', async () => {
    const http = await start();
    const s = await student('github|42');
    auth0.identitiesStatus = 429;
    auth0.failureHeaders = { 'retry-after': '7' };
    const res = await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(503);
    expect(res.body.code).toBe('INTEGRATION_UNAVAILABLE');
    expect(res.headers['retry-after']).toBe('7');
  });

  it('GitHub over its limit is 429 GITHUB_RATE_LIMITED with GitHub’s Retry-After', async () => {
    const http = await start();
    const s = await student('github|43');
    linkedAtAuth0(s.sub, '43', 'tt');
    gh.userMode = 'secondary-limit';
    const res = await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(429);
    expect(res.body.code).toBe('GITHUB_RATE_LIMITED');
    expect(res.headers['retry-after']).toBe('37');
  });
});

describe('link', () => {
  it('links a secondary GitHub sign-in: reserve, Auth0 link, then connected and verified', async () => {
    const http = await start();
    const s = await student('auth0|linker');
    const nonce = await nonceFor(http, s);
    githubKnows('77', 'linker-gh');
    const token = await idToken('77', nonce);

    const res = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: token })
      .expect(200);
    expect(res.body).toEqual({ state: 'connected', login: 'linker-gh' });

    const link = auth0.callsTo('/api/v2/users/').find((c) => c.method === 'POST')!;
    expect(link.path).toBe(`/api/v2/users/${encodeURIComponent(s.sub)}/identities`);
    expect(link.authorization).toBe(`Bearer ${auth0.m2mToken}`);
    expect(link.body).toEqual({ link_with: token });

    expect(await githubRow(s.id)).toMatchObject({
      status: 'connected',
      externalUserId: '77',
      externalLogin: 'linker-gh',
    });
    expect(await verifiedOf(s.id)).toBe(true);
    expect(await db.selectFrom('integrationNonces').selectAll().execute()).toEqual([]);
  });

  it('a nonce works once: replaying the same id token is 400 INVALID_NONCE', async () => {
    const http = await start();
    const s = await student('auth0|replay');
    githubKnows('78', 'r');
    const token = await idToken('78', await nonceFor(http, s));
    await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: token })
      .expect(200);
    await http.delete('/v1/me/integrations/github').set(s.auth).expect(200);
    const again = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: token })
      .expect(400);
    expect(again.body.code).toBe('INVALID_NONCE');
  });

  it('another user’s nonce is 400, and nothing of theirs changes (second user)', async () => {
    const http = await start();
    const alice = await student('auth0|alice');
    const bob = await student('auth0|bob');
    const alicesNonce = await nonceFor(http, alice);
    const res = await http
      .post('/v1/me/integrations/github/link')
      .set(bob.auth)
      .send({ idToken: await idToken('79', alicesNonce) })
      .expect(400);
    expect(res.body.code).toBe('INVALID_NONCE');
    expect(auth0.callsTo('/api/v2/users/').filter((c) => c.method === 'POST')).toEqual([]);
    expect(await githubRow(bob.id)).toBeUndefined();
    // Alice's nonce is still hers to use.
    expect(await db.selectFrom('integrationNonces').select('userId').execute()).toEqual([
      { userId: alice.id },
    ]);
  });

  it('an expired nonce is 400', async () => {
    const http = await start();
    const s = await student('auth0|late');
    const nonce = await nonceFor(http, s);
    await db
      .updateTable('integrationNonces')
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .execute();
    const res = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: await idToken('80', nonce) })
      .expect(400);
    expect(res.body.code).toBe('INVALID_NONCE');
  });

  it('refuses each bad id token with 400 INVALID_ID_TOKEN and touches nothing', async () => {
    const http = await start();
    const s = await student('auth0|forger');
    const nonce = await nonceFor(http, s);
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: 'github|81',
      iss: tenant.issuer,
      aud: SPA_CLIENT_ID,
      exp: now + 600,
      iat: now,
      nonce,
    };
    const bad: [string, string][] = [
      ['alg none', `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.`],
      [
        'wrong issuer',
        await tenant.sign({
          sub: 'github|81',
          aud: SPA_CLIENT_ID,
          iss: 'https://evil.example/',
          extra: { nonce },
        }),
      ],
      ['access-token audience', await tenant.sign({ sub: 'github|81', extra: { nonce } })],
      [
        'expired',
        await tenant.sign({ sub: 'github|81', aud: SPA_CLIENT_ID, expIn: -60, extra: { nonce } }),
      ],
      [
        'issued 10 minutes ago',
        await tenant.sign({ sub: 'github|81', aud: SPA_CLIENT_ID, iatIn: -600, extra: { nonce } }),
      ],
      [
        'not a GitHub sub',
        await tenant.sign({ sub: 'google-oauth2|81', aud: SPA_CLIENT_ID, extra: { nonce } }),
      ],
      [
        'other key',
        await tenant.sign(
          { sub: 'github|81', aud: SPA_CLIENT_ID, extra: { nonce } },
          { key: 'other' },
        ),
      ],
    ];
    for (const [label, token] of bad) {
      const res = await http
        .post('/v1/me/integrations/github/link')
        .set(s.auth)
        .send({ idToken: token });
      expect(res.status, label).toBe(400);
      expect(res.body.code, label).toBe('INVALID_ID_TOKEN');
    }
    // A valid token whose nonce was never issued.
    const unknown = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: await idToken('81', 'never-issued') })
      .expect(400);
    expect(unknown.body.code).toBe('INVALID_NONCE');
    // The body is strict.
    const extra = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: await idToken('81', nonce), url: 'https://evil.example/' })
      .expect(400);
    expect(extra.body.code).toBe('VALIDATION_FAILED');

    expect(await githubRow(s.id)).toBeUndefined();
    expect(auth0.callsTo('/api/v2/users/').filter((c) => c.method === 'POST')).toEqual([]);
    // The real nonce was never consumed by any of these.
    expect(await db.selectFrom('integrationNonces').selectAll().execute()).toHaveLength(1);
  });

  it('a GitHub login that already is a Gradfolio account is 409, before Auth0 is touched', async () => {
    const http = await start();
    await createUser(db, { auth0Id: 'github|88', name: 'GitHub-only student' });
    const s = await student('auth0|wants-88');
    const res = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: await idToken('88', await nonceFor(http, s)) })
      .expect(409);
    expect(res.body.code).toBe('GITHUB_ACCOUNT_IN_USE');
    expect(auth0.callsTo('/api/v2/users/').filter((c) => c.method === 'POST')).toEqual([]);
    expect(await githubRow(s.id)).toBeUndefined();
  });

  it.each(['linking', 'connected'] as const)(
    'a first request as a GitHub login another account holds (%s) is refused and creates no row',
    async (status) => {
      const http = await start();
      const holder = await student('auth0|holds-150');
      await db
        .insertInto('integrations')
        .values({
          id: newId(),
          userId: holder.id,
          integrationType: 'github',
          status,
          externalUserId: '150',
        })
        .execute();
      const token = await tenant.sign({ sub: 'github|150' });
      const res = await http
        .get('/v1/me')
        .set({ Authorization: `Bearer ${token}` })
        .expect(401);
      expect((res.body as { code: string }).code).toBe('UNAUTHENTICATED');
      expect(
        await db.selectFrom('users').select('id').where('auth0Id', '=', 'github|150').execute(),
      ).toEqual([]);
    },
  );

  it('a link and a first login of the same GitHub account at once: never both (barrier)', async () => {
    const http = await start();
    const s = await student('auth0|linking-151');
    githubKnows('151', 'both');
    const token = await idToken('151', await nonceFor(http, s));
    const github151 = { Authorization: `Bearer ${await tenant.sign({ sub: 'github|151' })}` };

    const holder = await createConnection({ uri: testDatabaseUrl() });
    let linkRes: request.Response;
    let meRes: request.Response;
    try {
      // Holds the reservation's key: the link stops after its account check,
      // right before it inserts the reservation.
      await holder.query('START TRANSACTION');
      await holder.query(
        "SELECT id FROM integrations WHERE integration_type = 'github' AND external_user_id = '151' FOR UPDATE",
      );
      const linking = http
        .post('/v1/me/integrations/github/link')
        .set(s.auth)
        .send({ idToken: token })
        .then((r) => r);
      await waitForLockWaiters(1);
      // The first request as that GitHub login, now: its provisioning either
      // waits on the link's lock (fixed) or commits at once (not fixed).
      const provisioning = http
        .get('/v1/me')
        .set(github151)
        .then((r) => r);
      const waited = waitForLockWaiters(2).then(() => 'waiting');
      waited.catch(() => undefined);
      await Promise.race([waited, provisioning]);
      await holder.query('ROLLBACK');
      [linkRes, meRes] = await Promise.all([linking, provisioning]);
    } finally {
      await holder.end();
    }

    const orphan = await db
      .selectFrom('users')
      .select('id')
      .where('auth0Id', '=', 'github|151')
      .executeTakeFirst();
    const held = (await githubRow(s.id))?.externalUserId === '151';
    // One of them wins; a users row for a GitHub account linked to another account never stands.
    expect(orphan !== undefined && held).toBe(false);
    expect([`link ${linkRes.status}`, `me ${meRes.status}`].join(', ')).toMatch(
      /^(link 200, me 401|link 409, me 200)$/,
    );
  });

  it('a GitHub id another Gradfolio user holds is 409 on the unique key, before Auth0 is touched', async () => {
    const http = await start();
    const holder = await student('auth0|holder');
    await db
      .insertInto('integrations')
      .values({
        id: newId(),
        userId: holder.id,
        integrationType: 'github',
        status: 'connected',
        externalUserId: '89',
        externalLogin: 'holder-gh',
      })
      .execute();
    const s = await student('auth0|second');
    const res = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: await idToken('89', await nonceFor(http, s)) })
      .expect(409);
    expect(res.body.code).toBe('GITHUB_ACCOUNT_IN_USE');
    expect(auth0.callsTo('/api/v2/users/').filter((c) => c.method === 'POST')).toEqual([]);
    expect(await githubRow(s.id)).toBeUndefined();
    // The holder's row is untouched.
    expect(await githubRow(holder.id)).toMatchObject({ status: 'connected', externalUserId: '89' });
  });

  it('two concurrent links with one nonce: exactly one wins (barrier on the nonce row)', async () => {
    const http = await start();
    const s = await student('auth0|racer');
    const nonce = await nonceFor(http, s);
    githubKnows('90', 'racer-gh');
    const token = await idToken('90', nonce);

    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT hash FROM integration_nonces WHERE hash = ? FOR UPDATE', [
        sha256(nonce),
      ]);
      const send = () =>
        http
          .post('/v1/me/integrations/github/link')
          .set(s.auth)
          .send({ idToken: token })
          .then((r) => r);
      const both = Promise.all([send(), send()]);
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      const statuses = (await both).map((r) => `${r.status} ${r.body.code ?? r.body.state}`);
      expect(statuses.toSorted()).toEqual(['200 connected', '400 INVALID_NONCE']);
    } finally {
      await holder.end();
    }
    expect(auth0.callsTo('/api/v2/users/').filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('is idempotent: an identity Auth0 already holds is connected without linking again (the account-deleted case)', async () => {
    const http = await start();
    const s = await student('auth0|already-held');
    githubKnows('97', 'held-gh');
    const token = await idToken('97', await nonceFor(http, s));
    // Meanwhile the identity is on the login at Auth0 (a link whose answer was lost, or one a
    // deleted account left behind): Auth0 would answer 400 to a second link.
    linkedAtAuth0(s.sub, '97', 'held-gh');
    const before = auth0.callsTo('/api/v2/users/').filter((c) => c.method === 'POST').length;

    const res = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: token })
      .expect(200);
    expect(res.body).toEqual({ state: 'connected', login: 'held-gh' });
    expect(auth0.callsTo('/api/v2/users/').filter((c) => c.method === 'POST')).toHaveLength(before);
    expect(await githubRow(s.id)).toMatchObject({ status: 'connected', externalUserId: '97' });
    expect(await verifiedOf(s.id)).toBe(true);
  });

  it('connects the identity that was linked when the login holds several GitHub identities', async () => {
    const http = await start();
    const s = await student('auth0|two-github');
    githubKnows('201', 'first-gh');
    githubKnows('202', 'second-gh');
    const token = await idToken('202', await nonceFor(http, s));
    // Auth0 now holds two GitHub identities for the login; the id token names the second.
    linkedAtAuth0(s.sub, '201', 'first-gh');
    auth0.users.get(s.sub)!.push({
      provider: 'github',
      user_id: 202,
      connection: 'github',
      isSocial: true,
      access_token: auth0.githubTokenFor('202'),
    });
    const res = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: token })
      .expect(200);
    expect(res.body).toEqual({ state: 'connected', login: 'second-gh' });
    expect(await githubRow(s.id)).toMatchObject({
      externalUserId: '202',
      externalLogin: 'second-gh',
    });
  });

  describe('a login holding several GitHub identities, the linked one not first', () => {
    /** Auth0 lists identity `first` before `second`; `second` is linked. Returns the student, connected to it. */
    async function connectedToSecond(http: Http, first: string, second: string) {
      const s = await student(`auth0|several-${first}`);
      githubKnows(first, `gh-${first}`);
      githubKnows(second, `gh-${second}`);
      const token = await idToken(second, await nonceFor(http, s));
      linkedAtAuth0(s.sub, first, `gh-${first}`);
      auth0.users.get(s.sub)!.push({
        provider: 'github',
        user_id: Number(second),
        connection: 'github',
        isSocial: true,
        access_token: auth0.githubTokenFor(second),
      });
      await http
        .post('/v1/me/integrations/github/link')
        .set(s.auth)
        .send({ idToken: token })
        .expect(200);
      expect(await githubRow(s.id)).toMatchObject({ status: 'connected', externalUserId: second });
      return s;
    }
    const lastAuthorization = (path: string) =>
      gh.requests.filter((r) => r.path === path).at(-1)?.authorization;

    it('every later GitHub read uses the connected identity, with the cache and without it', async () => {
      for (const [cache, first, second] of [
        ['300', '211', '212'],
        ['0', '213', '214'],
      ] as const) {
        const http = await start({ ...GITHUB_ENV(), GITHUB_TOKEN_CACHE_S: cache });
        const s = await connectedToSecond(http, first, second);
        gh.requests.length = 0;
        await http.get('/v1/me/github/repos').set(s.auth).expect(200);
        await http.get('/v1/me/github/repos').set(s.auth).expect(200);
        expect(lastAuthorization('/user/repos'), cache).toBe(
          `Bearer ${auth0.githubTokenFor(second)}`,
        );
        // Connect again: the connection stays on its own identity.
        await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
        expect(await githubRow(s.id)).toMatchObject({
          externalUserId: second,
          externalLogin: `gh-${second}`,
        });
      }
    });

    it('disconnect revokes the connected identity’s grant, not the first one’s', async () => {
      const http = await start();
      const s = await connectedToSecond(http, '221', '222');
      await http.delete('/v1/me/integrations/github').set(s.auth).expect(200);
      expect(gh.revoked).toEqual([auth0.githubTokenFor('222')]);
      expect(gh.tokens.has(auth0.githubTokenFor('221'))).toBe(true);
      expect(await githubRow(s.id)).toMatchObject({ status: 'not_connected' });
    });

    it('a half-done link to the second identity settles to that identity', async () => {
      const http = await start();
      const s = await student('auth0|several-half');
      githubKnows('231', 'gh-231');
      githubKnows('232', 'gh-232');
      const token = await idToken('232', await nonceFor(http, s));
      auth0.linkStatus = 504;
      await http
        .post('/v1/me/integrations/github/link')
        .set(s.auth)
        .send({ idToken: token })
        .expect(503);
      delete auth0.linkStatus;
      // Auth0 did link it after all, and the login also holds the first identity.
      linkedAtAuth0(s.sub, '231', 'gh-231');
      auth0.users.get(s.sub)!.push({
        provider: 'github',
        user_id: 232,
        connection: 'github',
        isSocial: true,
        access_token: auth0.githubTokenFor('232'),
      });
      await ageReservation(s.id);
      const card = await http.get('/v1/me/integrations').set(s.auth).expect(200);
      expect(card.body.github).toMatchObject({ status: 'connected', login: 'gh-232' });
    });
  });

  it('a refusal is logged with Auth0’s own words, never a credential', async () => {
    const http = await start();
    const s = await student('auth0|refused-words');
    githubKnows('99', 'words');
    const token = await idToken('99', await nonceFor(http, s));
    auth0.linkStatus = 400;
    auth0.linkBody = {
      statusCode: 400,
      error: 'Bad Request',
      message: 'Cannot link a user to itself\n(fake)',
      errorCode: 'invalid_body',
    };
    logs.clear();
    await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: token })
      .expect(409);
    const line = logs.lines().find((l) => l.msg === 'github link refused by auth0')!;
    expect(line).toMatchObject({
      status: 400,
      auth0Error: 'Bad Request',
      auth0Message: 'Cannot link a user to itself (fake)',
      auth0Code: 'invalid_body',
    });
    expect(logs.text()).not.toContain(token);
    expect(logs.text()).not.toMatch(/SENTINEL/);
  });

  it('a link Auth0 refuses releases the reservation: 409 GITHUB_LINK_REFUSED', async () => {
    const http = await start();
    const s = await student('auth0|refused');
    auth0.linkStatus = 400;
    const res = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: await idToken('91', await nonceFor(http, s)) })
      .expect(409);
    expect(res.body.code).toBe('GITHUB_LINK_REFUSED');
    expect(await githubRow(s.id)).toMatchObject({ status: 'not_connected', externalUserId: null });
  });

  it('Auth0 over its limit on the link: nothing was linked, the reservation goes, 503', async () => {
    const http = await start();
    const s = await student('auth0|limited');
    auth0.linkStatus = 429;
    auth0.failureHeaders = { 'retry-after': '3' };
    const res = await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: await idToken('92', await nonceFor(http, s)) })
      .expect(503);
    expect(res.headers['retry-after']).toBe('3');
    expect(await githubRow(s.id)).toMatchObject({ status: 'not_connected', externalUserId: null });
  });

  it('an Auth0 5xx leaves the outcome unknown: the reservation stays, and counts as not connected', async () => {
    const http = await start();
    const s = await student('auth0|unknown');
    auth0.linkStatus = 502;
    await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: await idToken('93', await nonceFor(http, s)) })
      .expect(503);
    expect(await githubRow(s.id)).toMatchObject({ status: 'linking', externalUserId: '93' });
    const card = await http.get('/v1/me/integrations').set(s.auth).expect(200);
    expect(card.body.github.status).toBe('not_connected');
    expect(await verifiedOf(s.id)).toBe(false);
    // A second link while it is young is refused, not stacked.
    const again = await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(409);
    expect(again.body.code).toBe('GITHUB_LINK_IN_PROGRESS');
  });
});

describe('a half-done link settles from Auth0’s record (reconciliation)', () => {
  const admin = async () => {
    const url = new URL(adminDatabaseUrl());
    url.pathname = `/${new URL(testDatabaseUrl()).pathname.slice(1)}`;
    return createConnection({ uri: url.toString() });
  };

  it('Auth0 linked but step 5 failed: the next GET /me/integrations finishes it', async () => {
    const http = await start();
    const s = await student('auth0|half');
    githubKnows('94', 'half-gh');
    const token = await idToken('94', await nonceFor(http, s));

    // An injected failure in step 5: the database refuses the 'connected' write.
    const conn = await admin();
    try {
      await conn.query(`CREATE TRIGGER fail_connect BEFORE UPDATE ON integrations FOR EACH ROW
        BEGIN IF NEW.status = 'connected' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected'; END IF; END`);
      await http
        .post('/v1/me/integrations/github/link')
        .set(s.auth)
        .send({ idToken: token })
        .expect(500);
    } finally {
      await conn.query('DROP TRIGGER IF EXISTS fail_connect');
      await conn.end();
    }
    expect(await githubRow(s.id)).toMatchObject({ status: 'linking', externalUserId: '94' });

    await ageReservation(s.id);
    const card = await http.get('/v1/me/integrations').set(s.auth).expect(200);
    expect(card.body.github).toMatchObject({ status: 'connected', login: 'half-gh' });
    expect(await githubRow(s.id)).toMatchObject({ status: 'connected', externalLogin: 'half-gh' });
    expect(await verifiedOf(s.id)).toBe(true);
  });

  it('Auth0 never linked: the next connect releases the reservation', async () => {
    const http = await start();
    const s = await student('auth0|never');
    auth0.linkStatus = 504;
    await http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: await idToken('95', await nonceFor(http, s)) })
      .expect(503);
    delete auth0.linkStatus;
    await ageReservation(s.id);

    const res = await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
    expect(res.body.state).toBe('link_required');
    expect(await githubRow(s.id)).toMatchObject({ status: 'not_connected', externalUserId: null });
  });

  it('a reservation whose link is still in flight is left alone (barrier on Auth0’s link)', async () => {
    const http = await start();
    const s = await student('auth0|inflight');
    githubKnows('96', 'inflight-gh');
    const token = await idToken('96', await nonceFor(http, s));
    const gate = auth0.holdNextLink();

    const linking = http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: token })
      .then((r) => r);
    await gate.arrived;
    const readsBefore = auth0.callsTo('/api/v2/users/').filter((c) => c.method === 'GET').length;
    const card = await http.get('/v1/me/integrations').set(s.auth).expect(200);
    expect(card.body.github.status).toBe('not_connected');
    expect(await githubRow(s.id)).toMatchObject({ status: 'linking', externalUserId: '96' });
    // Not even asked: a young reservation is not a candidate.
    expect(auth0.callsTo('/api/v2/users/').filter((c) => c.method === 'GET')).toHaveLength(
      readsBefore,
    );

    gate.release();
    expect((await linking).status).toBe(200);
    expect(await githubRow(s.id)).toMatchObject({ status: 'connected' });
  });
});

describe('disconnect (revoke first, D9)', () => {
  async function connected(http: Awaited<ReturnType<typeof start>>, sub: string, githubId: string) {
    const s = await student(sub);
    linkedAtAuth0(sub, githubId, `${githubId}-login`);
    await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
    gh.requests.length = 0;
    return s;
  }

  it('revokes the grant at GitHub, then clears the flag, the GitHub id and verified', async () => {
    const http = await start();
    const s = await connected(http, 'github|100', '100');
    await db.updateTable('integrations').set({ lastSyncedAt: new Date() }).execute();

    const res = await http.delete('/v1/me/integrations/github').set(s.auth).expect(200);
    expect(res.body).toEqual({ status: 'not_connected' });

    const grant = gh.requests.find((r) => r.method === 'DELETE')!;
    expect(grant.path).toBe(`/applications/${gh.clientId}/grant`);
    expect(grant.authorization).toBe(
      `Basic ${Buffer.from(`${gh.clientId}:${gh.clientSecret}`).toString('base64')}`,
    );
    expect(grant.body).toEqual({ access_token: auth0.githubTokenFor('100') });
    expect(gh.revoked).toEqual([auth0.githubTokenFor('100')]);

    expect(await githubRow(s.id)).toMatchObject({
      status: 'not_connected',
      externalUserId: null,
      externalLogin: null,
      lastSyncedAt: null,
    });
    // Back to the token's email_verified (false here).
    expect(await verifiedOf(s.id)).toBe(false);
    const me = await http.get('/v1/me').set(s.auth).expect(200);
    expect(me.body.verified).toBe(false);
  });

  it('revokes with the token Auth0 holds now, not a cached one GitHub already refuses', async () => {
    const http = await start();
    const s = await connected(http, 'github|104', '104');
    // The student signed in with GitHub again since: Auth0 now holds a new token,
    // and the one cached at connect is dead at GitHub.
    const stale = auth0.githubTokenFor('104');
    gh.tokens.delete(stale);
    auth0.githubTokenFor = (id) => `gho_SENTINEL_renewed_${id}`;
    try {
      linkedAtAuth0(s.sub, '104', '104-login');
      await http.delete('/v1/me/integrations/github').set(s.auth).expect(200);
      expect(gh.revoked).toEqual(['gho_SENTINEL_renewed_104']);
    } finally {
      auth0.githubTokenFor = (id) => `gho_SENTINEL_${id}`;
    }
  });

  it('a connect whose GitHub answer was in flight during a disconnect does not restore it (barrier)', async () => {
    const http = await start();
    const s = await connected(http, 'github|105', '105');
    // A second connect has asked GitHub, which confirmed the token; the answer is in flight.
    const gate = gh.holdNextUser();
    const reconnect = http
      .post('/v1/me/integrations/github/connect')
      .set(s.auth)
      .then((r) => r);
    await gate.arrived;
    // Meanwhile the student disconnects: the token is revoked and the flag cleared.
    await http.delete('/v1/me/integrations/github').set(s.auth).expect(200);
    expect(gh.revoked).toEqual([auth0.githubTokenFor('105')]);
    gate.release();

    const res = await reconnect;
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('GITHUB_STATE_CHANGED');
    expect(await githubRow(s.id)).toMatchObject({ status: 'not_connected', externalUserId: null });
    expect(await verifiedOf(s.id)).toBe(false);
  });

  it('a connect while the grant delete is in flight is refused, not stamped onto the dying grant (barrier)', async () => {
    const http = await start();
    const s = await connected(http, 'github|107', '107');
    const token = auth0.githubTokenFor('107');
    // The DELETE has reached GitHub but is not processed: the token still works there.
    const gate = gh.holdNextGrantRequest();
    const disconnecting = http
      .delete('/v1/me/integrations/github')
      .set(s.auth)
      .then((r) => r);
    await gate.arrived;
    expect(await githubRow(s.id)).toMatchObject({ status: 'linking', externalUserId: '107' });

    const userReads = () => gh.requests.filter((r) => r.path === '/user').length;
    const before = userReads();
    const res = await http.post('/v1/me/integrations/github/connect').set(s.auth);
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('GITHUB_LINK_IN_PROGRESS');
    // It never asked GitHub to validate the token that is about to die.
    expect(userReads()).toBe(before);
    // The card does not claim a connection that is being revoked.
    const card = await http.get('/v1/me/integrations').set(s.auth).expect(200);
    expect(card.body.github.status).toBe('not_connected');

    gate.release();
    expect((await disconnecting).status).toBe(200);
    expect(gh.revoked).toEqual([token]);
    expect(await githubRow(s.id)).toMatchObject({ status: 'not_connected', externalUserId: null });
    expect(await verifiedOf(s.id)).toBe(false);
  });

  it('a connect during a revocation waits; once it settled, the student connects with the new token', async () => {
    const http = await start();
    const s = await connected(http, 'github|106', '106');
    const first = auth0.githubTokenFor('106');
    // The grant is deleted at GitHub; the 204 is in flight.
    const gate = gh.holdNextGrant();
    const disconnecting = http
      .delete('/v1/me/integrations/github')
      .set(s.auth)
      .then((r) => r);
    await gate.arrived;
    // The student signs in with GitHub again (Auth0 now holds a new token) and connects.
    auth0.githubTokenFor = (id) => `gho_SENTINEL_again_${id}`;
    try {
      linkedAtAuth0(s.sub, '106', '106-login');
      const early = await http.post('/v1/me/integrations/github/connect').set(s.auth);
      expect(early.status).toBe(409);
      expect((early.body as { code: string }).code).toBe('GITHUB_LINK_IN_PROGRESS');
      gate.release();
      expect((await disconnecting).status).toBe(200);
      expect(gh.revoked).toEqual([first]);

      await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
    } finally {
      auth0.githubTokenFor = (id) => `gho_SENTINEL_${id}`;
    }
    // The new connection, whose token was never revoked, stands.
    expect(await githubRow(s.id)).toMatchObject({ status: 'connected', externalUserId: '106' });
    expect(await verifiedOf(s.id)).toBe(true);
  });

  it('a revocation marker is settled from GitHub’s word, later than a link reservation (age, then token state)', async () => {
    const http = await start();
    const s = await connected(http, 'github|108', '108');
    await db.updateTable('integrations').set({ lastSyncedAt: new Date() }).execute();
    // A disconnect that died after marking: the row is `linking` but keeps its login.
    await db
      .updateTable('integrations')
      .set({ status: 'linking' })
      .where('userId', '=', s.id)
      .execute();

    // Older than a link's deadline (10 s + margin) but younger than a revocation's
    // (20 s + margin): its GitHub call may still be in flight, so it is left alone.
    await ageReservation(s.id, 15);
    const callsBefore = auth0.calls.length;
    const young = await http.get('/v1/me/integrations').set(s.auth).expect(200);
    expect(young.body.github.status).toBe('not_connected');
    expect(auth0.calls.length).toBe(callsBefore);
    expect(await githubRow(s.id)).toMatchObject({ status: 'linking' });

    // Old enough, and the token still works at GitHub: the revocation never happened.
    await ageReservation(s.id, 3600);
    const back = await http.get('/v1/me/integrations').set(s.auth).expect(200);
    expect(back.body.github).toMatchObject({ status: 'connected', login: '108-login' });

    // The same marker, with the token dead at GitHub: it was revoked; sync time goes too.
    await db
      .updateTable('integrations')
      .set({ status: 'linking' })
      .where('userId', '=', s.id)
      .execute();
    await ageReservation(s.id, 3600);
    gh.tokens.delete(auth0.githubTokenFor('108'));
    const gone = await http.get('/v1/me/integrations').set(s.auth).expect(200);
    expect(gone.body.github.status).toBe('not_connected');
    expect(await githubRow(s.id)).toMatchObject({
      status: 'not_connected',
      externalUserId: null,
      lastSyncedAt: null,
    });
  });

  it('a refusal from GitHub changes nothing: 502 GITHUB_REVOKE_FAILED, still connected', async () => {
    const http = await start();
    const s = await connected(http, 'github|101', '101');
    gh.grantStatus = 403;
    const res = await http.delete('/v1/me/integrations/github').set(s.auth).expect(502);
    expect(res.body.code).toBe('GITHUB_REVOKE_FAILED');
    // The published contract: a refusal changed nothing.
    expect(res.body.message).toContain('nothing was changed');
    expect(await githubRow(s.id)).toMatchObject({ status: 'connected', externalUserId: '101' });
    expect(await verifiedOf(s.id)).toBe(true);
  });

  it('an unknown outcome (5xx, no answer) keeps the marker; it settles later from GitHub’s word', async () => {
    const http = await start();
    const s = await connected(http, 'github|109', '109');
    for (const fail of [
      () => (gh.grantStatus = 500),
      () => {
        gh.grantStatus = undefined;
        gh.grantHang = true;
      },
    ]) {
      fail();
      const res = await http.delete('/v1/me/integrations/github').set(s.auth).expect(502);
      expect(res.body.code).toBe('GITHUB_REVOKE_FAILED');
      // An unknown outcome does not claim "nothing changed".
      expect(res.body.message).toContain('may still be processing');
      expect(res.body.message).not.toContain('nothing was changed');
      expect(await githubRow(s.id)).toMatchObject({ status: 'linking', externalUserId: '109' });
      // GitHub did not process anything, so once the marker is old the token is
      // still good and the connection is restored by reconciliation.
      await ageReservation(s.id);
      const card = await http.get('/v1/me/integrations').set(s.auth).expect(200);
      expect(card.body.github.status).toBe('connected');
    }
  });

  it('a delete GitHub processed but never answered: a connect racing in is refused, then the revoked grant settles to disconnected (barrier)', async () => {
    const http = await start();
    const s = await connected(http, 'github|110', '110');
    const token = auth0.githubTokenFor('110');
    const gate = gh.holdNextGrantRequest();
    gh.grantDropAfterProcessing = true;
    const disconnecting = http
      .delete('/v1/me/integrations/github')
      .set(s.auth)
      .then((r) => r);
    await gate.arrived;
    // The connect that could stamp `connected` on the grant being deleted:
    const during = await http.post('/v1/me/integrations/github/connect').set(s.auth);
    expect(during.status).toBe(409);
    expect((during.body as { code: string }).code).toBe('GITHUB_LINK_IN_PROGRESS');

    gate.release();
    // GitHub deleted the grant and dropped the connection: the outcome is unknown.
    const res = await disconnecting;
    expect(res.status).toBe(502);
    expect(gh.revoked).toEqual([token]);
    expect(await githubRow(s.id)).toMatchObject({ status: 'linking', externalUserId: '110' });

    // A connect after the failure still finds the marker, and never validates the dead token.
    const userReads = () => gh.requests.filter((r) => r.path === '/user').length;
    const before = userReads();
    await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(409);
    expect(userReads()).toBe(before);

    // Nothing can be in flight any more: GitHub's word is "revoked".
    gh.grantDropAfterProcessing = false;
    await ageReservation(s.id);
    const card = await http.get('/v1/me/integrations').set(s.auth).expect(200);
    expect(card.body.github.status).toBe('not_connected');
    expect(await githubRow(s.id)).toMatchObject({ status: 'not_connected', externalUserId: null });
  });

  it('a grant GitHub says is already gone (422) still disconnects; a 404 changes nothing', async () => {
    const http = await start();
    const s = await connected(http, 'github|10422', '10422');
    gh.grantStatus = 404;
    await http.delete('/v1/me/integrations/github').set(s.auth).expect(502);
    expect(await githubRow(s.id)).toMatchObject({ status: 'connected' });
    gh.grantStatus = 422;
    await http.delete('/v1/me/integrations/github').set(s.auth).expect(200);
    expect(await githubRow(s.id)).toMatchObject({ status: 'not_connected' });
  });

  it('no GitHub identity left at Auth0 counts as revoked; a second disconnect revokes nothing', async () => {
    const http = await start();
    const s = await connected(http, 'auth0|unlinked', '102');
    auth0.users.set(
      s.sub,
      auth0.users.get(s.sub)!.filter((i) => i.provider !== 'github'),
    );
    await http.delete('/v1/me/integrations/github').set(s.auth).expect(200);
    await http.delete('/v1/me/integrations/github').set(s.auth).expect(200);
    expect(gh.requests.filter((r) => r.method === 'DELETE')).toEqual([]);
    expect(await githubRow(s.id)).toMatchObject({ status: 'not_connected' });
  });

  it('touches only the caller’s row (second user)', async () => {
    const http = await start();
    const alice = await connected(http, 'github|103', '103');
    const bob = await student('auth0|bob-dc');
    await http.delete('/v1/me/integrations/github').set(bob.auth).expect(200);
    expect(await githubRow(alice.id)).toMatchObject({ status: 'connected', externalUserId: '103' });
    expect(gh.requests.filter((r) => r.method === 'DELETE')).toEqual([]);
    const card = await http.get('/v1/me/integrations').set(bob.auth).expect(200);
    expect(card.body.github).toMatchObject({ status: 'not_connected', login: null });
  });
});

describe('LinkedIn on the card (plan §4.4)', () => {
  it('is connected for a LinkedIn sign-in or a linked LinkedIn identity, with the last import time', async () => {
    const http = await start();
    const viaSub = await student('linkedin|abc');
    const viaClaim = await student('auth0|li', { identities: ['auth0', 'linkedin'] });
    const plain = await student('auth0|no-li');
    const at = new Date('2026-10-01T10:00:00Z');
    await db
      .insertInto('integrations')
      .values({ id: newId(), userId: viaClaim.id, integrationType: 'linkedin', lastSyncedAt: at })
      .execute();

    const read = async (s: Student): Promise<unknown> =>
      (
        (await http.get('/v1/me/integrations').set(s.auth).expect(200)).body as {
          linkedin: unknown;
        }
      ).linkedin;
    expect(await read(viaSub)).toEqual({ status: 'connected', lastSyncedAt: null });
    expect(await read(viaClaim)).toEqual({ status: 'connected', lastSyncedAt: at.toISOString() });
    expect(await read(plain)).toEqual({ status: 'not_connected', lastSyncedAt: null });
  });
});

describe('the integration rate budget', () => {
  it('blocks the 3rd call of a route at a limit of 2, with Retry-After; other routes count separately', async () => {
    const http = await start({ ...GITHUB_ENV(), RATE_LIMIT_INTEGRATION: '2' });
    const s = await student('auth0|busy');
    await http.get('/v1/me/integrations').set(s.auth).expect(200);
    await http.get('/v1/me/integrations').set(s.auth).expect(200);
    const res = await http.get('/v1/me/integrations').set(s.auth).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
  });
});

describe('no token in any response or log (plan §10)', () => {
  it('sentinels through every flow, failures included, never reach a body, a header or the log', async () => {
    const http = await start();
    const texts: string[] = [];
    const keep = (r: request.Response) => {
      texts.push(JSON.stringify(r.body), JSON.stringify(r.headers));
      return r;
    };

    const a = await student('github|130');
    linkedAtAuth0(a.sub, '130', 'sentinel-a');
    keep(await http.post('/v1/me/integrations/github/connect').set(a.auth));
    keep(await http.get('/v1/me/integrations').set(a.auth));
    gh.grantStatus = 500;
    keep(await http.delete('/v1/me/integrations/github').set(a.auth));
    gh.grantStatus = undefined;
    keep(await http.delete('/v1/me/integrations/github').set(a.auth));

    const b = await student('auth0|sentinel-b');
    const nonceRes = await http.post('/v1/me/integrations/github/connect').set(b.auth);
    const nonce = nonceRes.body.nonce as string;
    githubKnows('131', 'sentinel-b');
    const token = await idToken('131', nonce);
    auth0.linkStatus = 502;
    keep(await http.post('/v1/me/integrations/github/link').set(b.auth).send({ idToken: token }));
    delete auth0.linkStatus;
    keep(await http.post('/v1/me/integrations/github/link').set(b.auth).send({ idToken: token }));
    keep(
      await http.post('/v1/me/integrations/github/link').set(b.auth).send({ idToken: 'not.a.jwt' }),
    );
    gh.userMode = 'status-500';
    const c = await student('github|132');
    linkedAtAuth0(c.sub, '132', 'sentinel-c');
    keep(await http.post('/v1/me/integrations/github/connect').set(c.auth));

    const responses = texts.join('\n');
    const logged = logs.text();
    const secrets = [
      'SENTINEL',
      auth0.githubTokenFor('130'),
      auth0.m2mToken,
      auth0.clientSecret,
      gh.clientSecret,
      token,
    ];
    for (const secret of secrets) {
      expect(responses, secret).not.toContain(secret);
      expect(logged, secret).not.toContain(secret);
    }
    expect(responses).not.toContain(sha256(nonce));
    expect(logged).not.toContain(nonce);
    expect(responses).not.toMatch(/"(externalUserId|external_user_id)"/);
    // The flows did run and were logged.
    expect(logged).toContain('github connected');
  });
});
