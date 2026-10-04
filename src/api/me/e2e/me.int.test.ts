import type { NestExpressApplication } from '@nestjs/platform-express';
import { createConnection } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testConfig, testDatabase, testDatabaseUrl } from '../../../testing/database.js';
import { startTestTenant, type TestTenant, type TokenClaims } from '../../../testing/jwks.js';

/**
 * GET /v1/me through the whole stack: the token guard, the rate limit, the
 * caller's row created on first login in real MySQL 8.4, the response.
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();
const db = testDatabase();

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
afterEach(async () => {
  logs.clear();
  await app?.close();
  app = undefined;
});

async function start(env: NodeJS.ProcessEnv = {}) {
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'warn',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
      ...env,
    }),
    undefined,
    { logs },
  );
  return request(app.getHttpServer());
}

const as = async (claims: TokenClaims) => ({
  Authorization: `Bearer ${await tenant.sign(claims)}`,
});

const rowsFor = (sub: string) =>
  db.selectFrom('users').selectAll().where('auth0Id', '=', sub).execute();

const google = (sub: string, over: Record<string, unknown> = {}): TokenClaims => ({
  sub,
  profile: {
    email: 'ani@example.com',
    email_verified: true,
    name: 'Ani Petrosyan',
    picture: 'https://lh3.googleusercontent.com/a/ani',
    identities: ['google-oauth2'],
    ...over,
  },
});

describe('GET /v1/me', () => {
  it('creates the caller on the first call, from the token, and returns the same id after', async () => {
    const http = await start();
    const sub = `google-oauth2|${newId()}`;
    const auth = await as(google(sub));

    const first = await http.get('/v1/me').set(auth).expect(200);
    expect(first.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Ani Petrosyan',
      email: 'ani@example.com',
      avatarUrl: 'https://lh3.googleusercontent.com/a/ani',
      headline: '',
      verified: true,
      isPublic: true,
      onboarded: false,
      identities: ['google-oauth2'],
    });
    const second = await http.get('/v1/me').set(auth).expect(200);
    expect(second.body.id).toBe(first.body.id);

    const rows = await rowsFor(sub);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.body.id, auth0Id: sub, name: 'Ani Petrosyan' });
  });

  it('never returns the auth0 id or private fields', async () => {
    const http = await start();
    const res = await http
      .get('/v1/me')
      .set(await as(google(`auth0|${newId()}`)))
      .expect(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'avatarUrl',
        'email',
        'headline',
        'id',
        'identities',
        'isPublic',
        'name',
        'onboarded',
        'verified',
      ].sort(),
    );
  });

  it('gives each caller their own row: a second user never sees the first', async () => {
    const http = await start();
    const alice = await http
      .get('/v1/me')
      .set(await as(google(`auth0|alice-${newId()}`, { name: 'Alice' })))
      .expect(200);
    const bob = await http
      .get('/v1/me')
      .set(await as(google(`auth0|bob-${newId()}`, { name: 'Bob' })))
      .expect(200);
    expect(alice.body.id).not.toBe(bob.body.id);
    expect(alice.body.name).toBe('Alice');
    expect(bob.body.name).toBe('Bob');
  });

  it('keeps what the account holds when a later token carries a different name', async () => {
    const http = await start();
    const sub = `auth0|${newId()}`;
    await http
      .get('/v1/me')
      .set(await as(google(sub, { name: 'Original' })))
      .expect(200);
    const later = await http
      .get('/v1/me')
      .set(await as(google(sub, { name: 'Changed At Provider' })))
      .expect(200);
    expect(later.body.name).toBe('Original');
  });

  it('makes verified follow email_verified, both ways', async () => {
    const http = await start();
    const sub = `auth0|${newId()}`;
    const seen: boolean[] = [];
    for (const verified of [false, true, false]) {
      const res = await http
        .get('/v1/me')
        .set(await as(google(sub, { email_verified: verified })))
        .expect(200);
      seen.push(res.body.verified as boolean);
      expect((await rowsFor(sub))[0]?.verified).toBe(verified);
    }
    expect(seen).toEqual([false, true, false]);
  });

  it('cuts or drops what does not fit, and still creates the account', async () => {
    const http = await start();
    const sub = `linkedin|${newId()}`;
    const res = await http
      .get('/v1/me')
      .set(
        await as({
          sub,
          profile: {
            name: 'n'.repeat(300),
            email: `${'e'.repeat(250)}@x.test`,
            picture: 'javascript:alert(1)',
            headline: 'h'.repeat(600),
          },
        }),
      )
      .expect(200);
    expect([...(res.body.name as string)]).toHaveLength(255);
    expect(res.body.email).toBeNull();
    expect(res.body.avatarUrl).toBeNull();
    expect(res.body.headline).toBe('h'.repeat(500));
  });

  it('creates the account with a fallback name when the token has no profile claims, and says so', async () => {
    const http = await start();
    const sub = `auth0|${newId()}`;
    const res = await http
      .get('/v1/me')
      .set(await as({ sub }))
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Gradfolio user', email: null, verified: false });
    expect(res.body.identities).toEqual(['auth0']);
    expect(logs.lines().find((l) => l.msg === 'token carries no profile claims')).toMatchObject({
      provider: 'auth0',
    });
  });

  it('refuses a request without a token and creates nothing', async () => {
    const http = await start();
    const before = await db.selectFrom('users').select('id').execute();
    await http.get('/v1/me').expect(401);
    expect(await db.selectFrom('users').select('id').execute()).toHaveLength(before.length);
  });

  it('checks the rate limit before it touches the database', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '1' });
    const sub = `auth0|${newId()}`;
    const auth = await as(google(sub));
    await http.get('/v1/me').set(auth).expect(200);
    await db.deleteFrom('users').where('auth0Id', '=', sub).execute();

    await http.get('/v1/me').set(auth).expect(429);
    // Provisioning before the limit would have created the row again.
    expect(await rowsFor(sub)).toHaveLength(0);
  });
});

describe('two first requests at once (barrier)', () => {
  it.each(['commit', 'rollback'] as const)(
    'yield one row and one id when a competing insert %ss',
    async (outcome) => {
      const http = await start();
      const sub = `google-oauth2|${newId()}`;
      const auth = await as(google(sub));
      const holder = await createConnection({ uri: testDatabaseUrl() });
      try {
        const holderId = newId();
        await holder.query('BEGIN');
        await holder.query("INSERT INTO users (id, auth0_id, name) VALUES (?, ?, 'holder')", [
          holderId,
          sub,
        ]);
        // `.then` starts each request now; supertest sends nothing until then.
        const calls = [1, 2].map(() =>
          http
            .get('/v1/me')
            .set(auth)
            .then((r) => r),
        );
        await waitForLockWaiters(2);
        await holder.query(outcome === 'commit' ? 'COMMIT' : 'ROLLBACK');
        const results = await Promise.all(calls);

        expect(results.map((r) => r.status)).toEqual([200, 200]);
        const ids = new Set(results.map((r) => r.body.id as string));
        expect(ids.size).toBe(1);
        if (outcome === 'commit') expect([...ids]).toEqual([holderId]);
        expect(await rowsFor(sub)).toHaveLength(1);
      } finally {
        await holder.end();
      }
    },
  );
});
