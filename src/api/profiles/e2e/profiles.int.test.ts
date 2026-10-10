import type { NestExpressApplication } from '@nestjs/platform-express';
import { createConnection } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testConfig, testDatabase, testDatabaseUrl } from '../../../testing/database.js';
import { createProfile, createProject, createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/**
 * M3 PR (a) through the whole stack against MySQL 8.4: who may read a profile
 * (Q3 option A), what a response may contain, and the header edit.
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

const as = async (sub: string) => ({ Authorization: `Bearer ${await tenant.sign({ sub })}` });

/** A user whose token `sub` is known, with every private column filled in. */
async function member(label: string, over: Parameters<typeof createUser>[1] = {}) {
  const sub = `auth0|${label}-${newId()}`;
  const user = await createUser(db, {
    auth0Id: sub,
    name: label,
    email: `${label}-login@private.example`,
    phone: '+374 99 123456',
    birthday: '2001-02-03',
    ...over,
  });
  return { sub, user, auth: await as(sub) };
}

const SECRETS = ['+374 99 123456', '2001-02-03', 'login@private.example'];
const FORBIDDEN_KEYS = [
  'auth0Id',
  'auth0_id',
  'phone',
  'birthday',
  'email',
  'accessToken',
  'refreshToken',
  'externalUserId',
  'createdAt',
  'updatedAt',
  'onboardedAt',
];

/** Every key and string value in a JSON body. */
function walk(node: unknown, keys: string[] = [], values: string[] = []) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, keys, values));
  else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      keys.push(k);
      walk(v, keys, values);
    }
  } else if (typeof node === 'string') values.push(node);
  return { keys, values };
}

beforeEach(async () => {
  await db.deleteFrom('users').execute();
});

describe('GET /v1/users/:id', () => {
  it('serves a public profile to an anonymous caller, with every section', async () => {
    const http = await start();
    const { user } = await createProfile(db, { name: 'Ani', isPublic: true, bio: 'Hi' });
    await createProject(db, user, { title: 'Public one', tags: ['AI'] });

    const res = await http.get(`/v1/users/${user.id}`).expect(200);
    expect(res.body).toMatchObject({
      id: user.id,
      name: 'Ani',
      bio: 'Hi',
      isOwner: false,
      isPublic: true,
      skills: ['TypeScript', 'MySQL'],
      education: [expect.objectContaining({ institution: expect.any(String), endYear: null })],
      experience: [expect.objectContaining({ start: '2024-06', end: '2024-09' })],
      certifications: [expect.objectContaining({ date: '2025-01', credentialUrl: null })],
      projects: [expect.objectContaining({ title: 'Public one', role: 'owner', tags: ['AI'] })],
    });
  });

  describe('Q3 (option A): a private profile is the owner’s alone', () => {
    it.each([
      ['an anonymous caller', 'anonymous'],
      ['another signed-in user', 'other'],
    ])('answers %s with 404, the same body as an unknown id', async (_label, who) => {
      const http = await start();
      const { user } = await createProfile(db, { isPublic: false });
      const other = await member('other');

      const asked = http.get(`/v1/users/${user.id}`);
      const res = await (who === 'other' ? asked.set(other.auth) : asked).expect(404);
      const missing = await http.get(`/v1/users/${newId()}`).expect(404);
      expect(res.body).toEqual(missing.body);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('shows the owner their own private profile, with isOwner', async () => {
      const http = await start();
      const me = await member('owner', { isPublic: false });
      const res = await http.get(`/v1/users/${me.user.id}`).set(me.auth).expect(200);
      expect(res.body).toMatchObject({ id: me.user.id, isOwner: true, isPublic: false });
    });

    it('hides the profile the moment the owner switches isPublic off, and shows it again', async () => {
      const http = await start();
      const me = await member('toggle');
      await http.get(`/v1/users/${me.user.id}`).expect(200);
      await http.patch('/v1/me/profile').set(me.auth).send({ isPublic: false }).expect(200);
      await http.get(`/v1/users/${me.user.id}`).expect(404);
      await http.patch('/v1/me/profile').set(me.auth).send({ isPublic: true }).expect(200);
      await http.get(`/v1/users/${me.user.id}`).expect(200);
    });
  });

  it('keeps a bad or expired token a 401 on this public route, never an anonymous read', async () => {
    const http = await start();
    const { user } = await createProfile(db);
    await http.get(`/v1/users/${user.id}`).set('Authorization', 'Bearer nope').expect(401);
    const expired = await tenant.sign({ sub: 'auth0|x', expIn: -60 });
    await http.get(`/v1/users/${user.id}`).set('Authorization', `Bearer ${expired}`).expect(401);
  });

  it('does not create an account for an anonymous read', async () => {
    const http = await start();
    const { user } = await createProfile(db);
    const before = await db.selectFrom('users').select('id').execute();
    await http.get(`/v1/users/${user.id}`).expect(200);
    expect(await db.selectFrom('users').select('id').execute()).toHaveLength(before.length);
  });

  it('answers 404 for an id that is not a UUID or is far too long', async () => {
    const http = await start();
    await http.get('/v1/users/not-a-uuid').expect(404);
    await http.get(`/v1/users/${'a'.repeat(5000)}`).expect(404);
  });

  describe('private fields', () => {
    it('never put birthday, phone, the login email or the auth0 id in a response', async () => {
      const http = await start();
      const owner = await member('priv', {
        contactEmail: 'public@contact.example',
        isPublic: true,
      });
      await db
        .insertInto('integrations')
        .values({
          id: newId(),
          userId: owner.user.id,
          integrationType: 'github',
          status: 'connected',
          accessToken: 'SECRET-ACCESS-TOKEN',
          refreshToken: 'SECRET-REFRESH-TOKEN',
          externalUserId: 'SECRET-EXTERNAL-ID',
        })
        .execute();
      const viewer = await member('viewer');

      const bodies = [
        (await http.get(`/v1/users/${owner.user.id}`).expect(200)).body,
        (await http.get(`/v1/users/${owner.user.id}`).set(viewer.auth).expect(200)).body,
        (await http.get(`/v1/users/${owner.user.id}`).set(owner.auth).expect(200)).body,
        (await http.get('/v1/me/profile').set(owner.auth).expect(200)).body,
        (
          await http
            .patch('/v1/me/profile')
            .set(owner.auth)
            .send({ headline: 'changed' })
            .expect(200)
        ).body,
      ];
      const banned = [
        ...SECRETS,
        owner.sub,
        'SECRET-ACCESS-TOKEN',
        'SECRET-REFRESH-TOKEN',
        'SECRET-EXTERNAL-ID',
      ];
      for (const body of bodies) {
        const { keys, values } = walk(body);
        expect(keys.filter((k) => FORBIDDEN_KEYS.includes(k))).toEqual([]);
        for (const secret of banned) {
          expect(
            values.filter((v) => v.includes(secret)),
            secret,
          ).toEqual([]);
        }
      }
      expect((bodies[0] as { contactEmail: string }).contactEmail).toBe('public@contact.example');
    });
  });

  describe('projects on a profile', () => {
    it('lists own and accepted-team projects; others see public published ones only', async () => {
      const http = await start();
      const owner = await member('proj-owner');
      const peer = await member('peer');
      const viewer = await member('viewer');

      await createProject(db, owner.user, { title: 'own public', tags: ['b', 'a'] });
      await createProject(db, owner.user, { title: 'own private', isPublic: false });
      await createProject(db, owner.user, { title: 'own draft', isDraft: true });
      const shared = await createProject(db, peer.user, { title: 'team public' });
      const sharedPrivate = await createProject(db, peer.user, {
        title: 'team private',
        isPublic: false,
      });
      const pending = await createProject(db, peer.user, { title: 'pending invite' });
      for (const [p, status] of [
        [shared, 'accepted'],
        [sharedPrivate, 'accepted'],
        [pending, 'pending'],
      ] as const) {
        await db
          .insertInto('projectTeamMembers')
          .values({
            id: newId(),
            projectId: p.project.id,
            userId: owner.user.id,
            name: owner.user.name,
            status,
          })
          .execute();
      }

      const titles = (body: { projects: { title: string }[] }) =>
        body.projects.map((p) => p.title).sort();

      const publicView = (await http.get(`/v1/users/${owner.user.id}`).set(viewer.auth).expect(200))
        .body;
      expect(titles(publicView)).toEqual(['own public', 'team public']);

      const ownerView = (await http.get(`/v1/users/${owner.user.id}`).set(owner.auth).expect(200))
        .body as { projects: { title: string; role: string; tags: string[] }[] };
      // Q4: the member sees the private (never draft) project they are accepted on
      expect(titles(ownerView)).toEqual([
        'own draft',
        'own private',
        'own public',
        'team private',
        'team public',
      ]);
      expect(ownerView.projects.find((p) => p.title === 'own public')).toMatchObject({
        role: 'owner',
        tags: ['b', 'a'],
      });
      expect(ownerView.projects.find((p) => p.title === 'team public')).toMatchObject({
        role: 'member',
      });
    });

    it('caps the list at PROFILE_PROJECTS_LIMIT', async () => {
      const http = await start({ PROFILE_PROJECTS_LIMIT: '2' });
      const owner = await member('cap');
      for (let i = 0; i < 4; i++) await createProject(db, owner.user, { title: `p${i}` });
      const res = await http.get(`/v1/users/${owner.user.id}`).expect(200);
      expect(res.body.projects).toHaveLength(2);
    });
  });
});

describe('GET and PATCH /v1/me/profile', () => {
  it('returns the caller’s header, created on first use with the pre-filled fields', async () => {
    const http = await start();
    const sub = `google-oauth2|${newId()}`;
    const token = await tenant.sign({
      sub,
      profile: { name: 'Ani', email: 'ani@login.example', picture: 'https://pic.example/a.png' },
    });
    const res = await http
      .get('/v1/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({
      id: expect.any(String),
      name: 'Ani',
      headline: '',
      bio: null,
      location: null,
      avatarUrl: 'https://pic.example/a.png',
      contactEmail: null,
      isPublic: true,
      links: { github: null, linkedin: null, twitter: null, website: null },
    });
  });

  it('changes only the fields sent, stores them, and returns the new header', async () => {
    const http = await start();
    const me = await member('edit', { location: 'Gyumri', headline: 'old' });
    const res = await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({
        headline: ' New headline ',
        bio: 'Plain text <b>not html</b>',
        contactEmail: 'me@contact.example',
        avatarUrl: 'https://img.example/me.png',
        links: { github: 'https://github.com/me' },
      })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'edit',
      headline: 'New headline',
      location: 'Gyumri',
      bio: 'Plain text <b>not html</b>',
      contactEmail: 'me@contact.example',
      avatarUrl: 'https://img.example/me.png',
      links: { github: 'https://github.com/me', linkedin: null },
    });
    const row = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', me.user.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      headline: 'New headline',
      contactEmail: 'me@contact.example',
      github: 'https://github.com/me',
      phone: '+374 99 123456',
      birthday: '2001-02-03',
    });
  });

  it('merges links per key and clears a field with null or a blank string', async () => {
    const http = await start();
    const me = await member('links');
    await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ links: { github: 'https://g.example', website: 'https://w.example' }, location: 'X' })
      .expect(200);
    const res = await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ links: { github: null }, location: '  ' })
      .expect(200);
    expect(res.body.links).toEqual({
      github: null,
      linkedin: null,
      twitter: null,
      website: 'https://w.example',
    });
    expect(res.body.location).toBeNull();
  });

  it('answers 200, not 404, when the patch changes nothing', async () => {
    const http = await start();
    const me = await member('same', { headline: 'same' });
    await http.patch('/v1/me/profile').set(me.auth).send({ headline: 'same' }).expect(200);
  });

  it.each([
    ['verified', true],
    ['email', 'x@y.example'],
    ['auth0Id', 'auth0|evil'],
    ['phone', '1'],
    ['birthday', '2000-01-01'],
    ['id', 'abc'],
    ['onboardedAt', '2020-01-01'],
    ['createdAt', '2020-01-01'],
  ])('refuses %s: 400, and the row is unchanged', async (key, value) => {
    const http = await start();
    const me = await member('mass');
    const before = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', me.user.id)
      .executeTakeFirstOrThrow();
    const res = await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ name: 'Hacked', [key]: value })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const after = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', me.user.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual(before);
  });

  it('refuses invalid input with field detail and writes nothing', async () => {
    const http = await start();
    const me = await member('bad');
    for (const body of [
      {},
      { name: '' },
      { avatarUrl: 'javascript:alert(1)' },
      { links: { website: 'data:text/html,x' } },
      { contactEmail: 'nope' },
      { isPublic: 'yes' },
    ]) {
      const res = await http.patch('/v1/me/profile').set(me.auth).send(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    const row = await db
      .selectFrom('users')
      .select('name')
      .where('id', '=', me.user.id)
      .executeTakeFirstOrThrow();
    expect(row.name).toBe('bad');
  });

  it('only ever changes the caller’s own row: a second user’s patch leaves the first untouched', async () => {
    const http = await start();
    const alice = await member('alice', { headline: 'alice-original' });
    const bob = await member('bob', { headline: 'bob-original' });
    await http
      .patch('/v1/me/profile')
      .set(bob.auth)
      .send({ headline: 'bob-new', name: 'Bob2' })
      .expect(200);
    const rows = await db.selectFrom('users').select(['id', 'headline', 'name']).execute();
    expect(rows.find((r) => r.id === alice.user.id)).toMatchObject({
      headline: 'alice-original',
      name: 'alice',
    });
    expect(rows.find((r) => r.id === bob.user.id)).toMatchObject({
      headline: 'bob-new',
      name: 'Bob2',
    });
  });

  it('answers 404, not 200, when the account is deleted after the request was authenticated', async () => {
    const http = await start();
    const me = await member('gone');
    await http.get('/v1/me').set(me.auth).expect(200); // the row exists

    // Hold the row so the UPDATE queues behind this lock (barrier, not a sleep),
    // then delete it and let the UPDATE run into the empty table.
    const admin = await createConnection({ uri: testDatabaseUrl() });
    await admin.beginTransaction();
    await admin.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [me.user.id]);
    const pending = http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ headline: 'late' })
      .then((r) => r);
    await waitForLockWaiters(1);
    await admin.query('DELETE FROM users WHERE id = ?', [me.user.id]);
    await admin.commit();
    await admin.end();

    expect((await pending).status).toBe(404);
  });
});

describe('onboarding', () => {
  it('starts not onboarded, completes idempotently, keeps the first timestamp', async () => {
    const http = await start();
    const me = await member('onb');
    expect((await http.get('/v1/me').set(me.auth).expect(200)).body.onboarded).toBe(false);

    await http.post('/v1/me/onboarding/complete').set(me.auth).expect(200, { onboarded: true });
    const first = await db
      .selectFrom('users')
      .select('onboardedAt')
      .where('id', '=', me.user.id)
      .executeTakeFirstOrThrow();
    expect(first.onboardedAt).toBeInstanceOf(Date);
    expect((await http.get('/v1/me').set(me.auth).expect(200)).body.onboarded).toBe(true);

    await db
      .updateTable('users')
      .set({ onboardedAt: new Date('2020-01-01T00:00:00Z') })
      .where('id', '=', me.user.id)
      .execute();
    await http.post('/v1/me/onboarding/complete').set(me.auth).expect(200);
    const again = await db
      .selectFrom('users')
      .select('onboardedAt')
      .where('id', '=', me.user.id)
      .executeTakeFirstOrThrow();
    expect(again.onboardedAt?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });

  it('is per caller: completing one user’s onboarding leaves another’s untouched', async () => {
    const http = await start();
    const a = await member('a');
    const b = await member('b');
    await http.post('/v1/me/onboarding/complete').set(a.auth).expect(200);
    const rows = await db.selectFrom('users').select(['id', 'onboardedAt']).execute();
    expect(rows.find((r) => r.id === b.user.id)?.onboardedAt).toBeNull();
  });

  it('answers 404 when the account is deleted after the request was authenticated', async () => {
    const http = await start();
    const me = await member('onb-gone');
    await http.get('/v1/me').set(me.auth).expect(200);
    const admin = await createConnection({ uri: testDatabaseUrl() });
    await admin.beginTransaction();
    await admin.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [me.user.id]);
    const pending = http
      .post('/v1/me/onboarding/complete')
      .set(me.auth)
      .then((r) => r);
    await waitForLockWaiters(1);
    await admin.query('DELETE FROM users WHERE id = ?', [me.user.id]);
    await admin.commit();
    await admin.end();
    expect((await pending).status).toBe(404);
  });

  it('needs a token', async () => {
    const http = await start();
    await http.post('/v1/me/onboarding/complete').expect(401);
  });
});

describe('rate limits', () => {
  it('gives every new route its own per-caller budget', async () => {
    const http = await start({
      RATE_LIMIT_DEFAULT: '2',
      // An anonymous caller with no vouched-for address is on the shared number.
      RATE_LIMIT_DEFAULT_SHARED: '2',
      RATE_LIMIT_WINDOW_S: '60',
    });
    const me = await member('rl');
    const calls: [string, () => request.Test][] = [
      ['GET /users/:id (anonymous)', () => http.get(`/v1/users/${me.user.id}`)],
      ['GET /users/:id (signed in)', () => http.get(`/v1/users/${me.user.id}`).set(me.auth)],
      ['GET /me/profile', () => http.get('/v1/me/profile').set(me.auth)],
      [
        'PATCH /me/profile',
        () => http.patch('/v1/me/profile').set(me.auth).send({ headline: 'x' }),
      ],
      ['POST /me/onboarding/complete', () => http.post('/v1/me/onboarding/complete').set(me.auth)],
    ];
    for (const [name, call] of calls) {
      await call().expect(200);
      await call().expect(200);
      expect((await call()).status, name).toBe(429);
    }
  });
});
