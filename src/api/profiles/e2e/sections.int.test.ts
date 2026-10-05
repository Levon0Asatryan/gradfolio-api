import type { NestExpressApplication } from '@nestjs/platform-express';
import { createConnection, type Connection } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testConfig, testDatabase, testDatabaseUrl } from '../../../testing/database.js';
import { createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/**
 * M3 PR (b) through the whole stack against MySQL 8.4: create / patch / delete
 * / reorder of education, experience and certifications, and replace-all
 * skills. Every race is forced with a lock held on a second connection and
 * `waitForLockWaiters`, never a sleep.
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();
const db = testDatabase();

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
beforeEach(async () => {
  await db.deleteFrom('users').execute();
  // The registry is global and outlives users: start each test with none.
  await db.deleteFrom('terms').execute();
});
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

async function member(label: string) {
  const sub = `auth0|${label}-${newId()}`;
  const user = await createUser(db, { auth0Id: sub, name: label });
  return { user, auth: { Authorization: `Bearer ${await tenant.sign({ sub })}` } };
}

interface SectionCase {
  name: string;
  path: string;
  table: 'education' | 'experience' | 'certifications';
  create: Record<string, unknown>;
  patch: Record<string, unknown>;
  /** A patch that is invalid for the stored entry as a whole. */
  breaking: Record<string, unknown>;
  invalid: Record<string, unknown>[];
}

const SECTIONS: SectionCase[] = [
  {
    name: 'education',
    path: '/v1/me/education',
    table: 'education',
    create: {
      institution: 'NPUA',
      degree: 'BSc',
      field: 'CS',
      startYear: 2022,
      endYear: 2026,
      highlights: ['Dean’s list'],
    },
    patch: { degree: 'MSc', description: 'Thesis on graphs' },
    breaking: { endYear: 2020 },
    invalid: [{ institution: '' }, { startYear: 1800 }, { highlights: [''] }],
  },
  {
    name: 'experience',
    path: '/v1/me/experience',
    table: 'experience',
    create: {
      title: 'Intern',
      organization: 'Picsart',
      start: '2024-06',
      end: '2024-09',
      summary: 'Built things',
      achievements: ['Shipped'],
      skills: ['react', 'Node.js'],
    },
    patch: { title: 'Engineer', end: null },
    breaking: { end: '2024-01' },
    invalid: [{ start: '2024-13' }, { end: 'Present' }, { title: '' }],
  },
  {
    name: 'certifications',
    path: '/v1/me/certifications',
    table: 'certifications',
    create: {
      name: 'AWS CP',
      issuer: 'AWS',
      date: '2025-01',
      credentialUrl: 'https://c.example/1',
    },
    patch: { name: 'AWS SAA', credentialUrl: null },
    breaking: { date: '2025-1' },
    invalid: [{ date: '2025' }, { credentialUrl: 'javascript:alert(1)' }, { issuer: '' }],
  },
];

const idsOf = (list: unknown) => (list as { id: string }[]).map((x) => x.id);

const count = async (table: SectionCase['table'], userId: string) =>
  (await db.selectFrom(table).select('id').where('userId', '=', userId).execute()).length;

describe.each(SECTIONS)('$name', (s) => {
  it('creates an entry first, returns it without internal columns, and stores it', async () => {
    const http = await start();
    const me = await member('creator');
    const a = await http.post(s.path).set(me.auth).send(s.create).expect(201);
    expect(a.body).toMatchObject({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(Object.keys(a.body)).not.toContain('userId');
    expect(Object.keys(a.body)).not.toContain('sortOrder');
    const b = await http.post(s.path).set(me.auth).send(s.create).expect(201);

    const profile = await http.get(`/v1/users/${me.user.id}`).expect(200);
    expect(idsOf(profile.body[s.name])).toEqual([b.body.id, a.body.id]);
    expect(await count(s.table, me.user.id)).toBe(2);
  });

  it.each(s.invalid)('refuses %j on create and on patch, writing nothing', async (bad) => {
    const http = await start();
    const me = await member('invalid');
    await http
      .post(s.path)
      .set(me.auth)
      .send({ ...s.create, ...bad })
      .expect(400);
    expect(await count(s.table, me.user.id)).toBe(0);

    const made = await http.post(s.path).set(me.auth).send(s.create).expect(201);
    const res = await http.patch(`${s.path}/${made.body.id}`).set(me.auth).send(bad).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const after = await http.get(`/v1/users/${me.user.id}`).expect(200);
    expect(after.body[s.name]).toEqual([made.body]);
  });

  it('refuses a missing required field and unknown keys on create', async () => {
    const http = await start();
    const me = await member('shape');
    await http.post(s.path).set(me.auth).send({}).expect(400);
    for (const key of ['id', 'userId', 'sortOrder']) {
      await http
        .post(s.path)
        .set(me.auth)
        .send({ ...s.create, [key]: 'x' })
        .expect(400);
      expect(await count(s.table, me.user.id)).toBe(0);
    }
  });

  it('patches some fields, keeps the rest, and answers 200 for a patch that changes nothing', async () => {
    const http = await start();
    const me = await member('patcher');
    const made = await http.post(s.path).set(me.auth).send(s.create).expect(201);
    const res = await http
      .patch(`${s.path}/${made.body.id}`)
      .set(me.auth)
      .send(s.patch)
      .expect(200);
    expect(res.body).toMatchObject({ id: made.body.id, ...s.patch });
    const unchanged = await http
      .patch(`${s.path}/${made.body.id}`)
      .set(me.auth)
      .send(s.patch)
      .expect(200);
    expect(unchanged.body).toEqual(res.body);
    await http.patch(`${s.path}/${made.body.id}`).set(me.auth).send({}).expect(400);
  });

  it('validates a patch against the stored entry as a whole', async () => {
    const http = await start();
    const me = await member('whole');
    const made = await http.post(s.path).set(me.auth).send(s.create).expect(201);
    const res = await http
      .patch(`${s.path}/${made.body.id}`)
      .set(me.auth)
      .send(s.breaking)
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('deletes an entry; a second delete is 404', async () => {
    const http = await start();
    const me = await member('deleter');
    const made = await http.post(s.path).set(me.auth).send(s.create).expect(201);
    await http.delete(`${s.path}/${made.body.id}`).set(me.auth).expect(204);
    expect(await count(s.table, me.user.id)).toBe(0);
    await http.delete(`${s.path}/${made.body.id}`).set(me.auth).expect(404);
  });

  describe('a second user', () => {
    it('gets 404 on patch, delete and reorder of the first user’s entries, and changes nothing', async () => {
      const http = await start();
      const alice = await member('alice');
      const bob = await member('bob');
      const a = await http.post(s.path).set(alice.auth).send(s.create).expect(201);
      const b = await http.post(s.path).set(alice.auth).send(s.create).expect(201);
      const mine = await http.post(s.path).set(bob.auth).send(s.create).expect(201);

      const before = await http.get(`/v1/users/${alice.user.id}`).expect(200);

      const patch = await http
        .patch(`${s.path}/${a.body.id}`)
        .set(bob.auth)
        .send(s.patch)
        .expect(404);
      const gone = await http.patch(`${s.path}/${newId()}`).set(bob.auth).send(s.patch).expect(404);
      expect(patch.body).toEqual(gone.body); // a foreign id looks like an unknown one
      await http.delete(`${s.path}/${a.body.id}`).set(bob.auth).expect(404);
      await http
        .put(`${s.path}/order`)
        .set(bob.auth)
        .send({ ids: [a.body.id, b.body.id, mine.body.id] })
        .expect(404);
      await http
        .put(`${s.path}/order`)
        .set(bob.auth)
        .send({ ids: [a.body.id] })
        .expect(404);

      const after = await http.get(`/v1/users/${alice.user.id}`).expect(200);
      expect(after.body[s.name]).toEqual(before.body[s.name]);
      const bobs = await http.get(`/v1/users/${bob.user.id}`).expect(200);
      expect(bobs.body[s.name]).toEqual([mine.body]);
    });
  });

  describe('reorder', () => {
    it('applies exactly the order given, atomically, and returns the section', async () => {
      const http = await start();
      const me = await member('orderer');
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push((await http.post(s.path).set(me.auth).send(s.create).expect(201)).body.id);
      }
      const order = [ids[1]!, ids[0]!, ids[2]!];
      const res = await http.put(`${s.path}/order`).set(me.auth).send({ ids: order }).expect(200);
      expect(idsOf(res.body)).toEqual(order);
      const rows = await db
        .selectFrom(s.table)
        .select(['id', 'sortOrder'])
        .where('userId', '=', me.user.id)
        .orderBy('sortOrder')
        .execute();
      expect(rows.map((r) => [r.id, r.sortOrder])).toEqual(order.map((id, i) => [id, i]));

      const profile = await http.get(`/v1/users/${me.user.id}`).expect(200);
      expect(idsOf(profile.body[s.name])).toEqual(order);
    });

    it('accepts an empty list for an empty section', async () => {
      const http = await start();
      const me = await member('empty');
      await http.put(`${s.path}/order`).set(me.auth).send({ ids: [] }).expect(200, []);
    });

    it('refuses a repeated id and an incomplete list (409 ORDER_STALE), leaving the order alone', async () => {
      const http = await start();
      const me = await member('stale');
      const a = (await http.post(s.path).set(me.auth).send(s.create).expect(201)).body.id;
      const b = (await http.post(s.path).set(me.auth).send(s.create).expect(201)).body.id;
      await http
        .put(`${s.path}/order`)
        .set(me.auth)
        .send({ ids: [a, a] })
        .expect(400);
      const res = await http
        .put(`${s.path}/order`)
        .set(me.auth)
        .send({ ids: [a] })
        .expect(409);
      expect(res.body.code).toBe('ORDER_STALE');
      const profile = await http.get(`/v1/users/${me.user.id}`).expect(200);
      expect(idsOf(profile.body[s.name])).toEqual([b, a]);
    });

    it('does not read "order" as an entry id', async () => {
      const http = await start();
      const me = await member('route');
      await http.delete(`${s.path}/order`).set(me.auth).expect(404);
    });
  });

  it('stops at the per-user cap with 409 LIMIT_REACHED', async () => {
    const http = await start({ PROFILE_MAX_SECTION_ITEMS: '2' });
    const me = await member('capped');
    await http.post(s.path).set(me.auth).send(s.create).expect(201);
    await http.post(s.path).set(me.auth).send(s.create).expect(201);
    const res = await http.post(s.path).set(me.auth).send(s.create).expect(409);
    expect(res.body.code).toBe('LIMIT_REACHED');
    expect(await count(s.table, me.user.id)).toBe(2);
    // the cap is per user and per section
    const other = await member('uncapped');
    await http.post(s.path).set(other.auth).send(s.create).expect(201);
  });

  it('needs a token', async () => {
    const http = await start();
    await http.post(s.path).send(s.create).expect(401);
    await http.patch(`${s.path}/${newId()}`).send(s.patch).expect(401);
    await http.delete(`${s.path}/${newId()}`).expect(401);
    await http.put(`${s.path}/order`).send({ ids: [] }).expect(401);
  });
});

describe('experience skills', () => {
  it('go through the terms registry: one spelling per name, shared with the skills list', async () => {
    const http = await start();
    const me = await member('terms');
    await http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: ['React'] })
      .expect(200);
    const made = await http
      .post('/v1/me/experience')
      .set(me.auth)
      .send({ ...SECTIONS[1]!.create, skills: ['react', 'REACT', 'Go'] })
      .expect(201);
    expect(made.body.skills).toEqual(['React', 'Go']);
    const patched = await http
      .patch(`/v1/me/experience/${made.body.id}`)
      .set(me.auth)
      .send({ skills: ['go', 'rust'] })
      .expect(200);
    expect(patched.body.skills).toEqual(['Go', 'rust']);
  });
});

describe('PUT /v1/me/skills', () => {
  it('replaces the whole list in the order given, with one spelling per name', async () => {
    const http = await start();
    const me = await member('skills');
    const first = await http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: ['TypeScript', ' react ', 'REACT', 'Go'] })
      .expect(200);
    expect(first.body).toEqual({ skills: ['TypeScript', 'react', 'Go'] });

    const second = await http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: ['Go', 'React'] })
      .expect(200);
    expect(second.body).toEqual({ skills: ['Go', 'react'] }); // the registry keeps the first spelling

    const stored = await db
      .selectFrom('userSkills')
      .select(['skillName', 'sortOrder'])
      .where('userId', '=', me.user.id)
      .orderBy('sortOrder')
      .execute();
    expect(stored.map((r) => [r.skillName, r.sortOrder])).toEqual([
      ['Go', 0],
      ['react', 1],
    ]);
    const profile = await http.get(`/v1/users/${me.user.id}`).expect(200);
    expect(profile.body.skills).toEqual(['Go', 'react']);

    await http.put('/v1/me/skills').set(me.auth).send({ skills: [] }).expect(200, { skills: [] });
    expect(
      await db.selectFrom('userSkills').select('id').where('userId', '=', me.user.id).execute(),
    ).toEqual([]);
  });

  it('only changes the caller’s list', async () => {
    const http = await start();
    const alice = await member('alice');
    const bob = await member('bob');
    await http
      .put('/v1/me/skills')
      .set(alice.auth)
      .send({ skills: ['A', 'B'] })
      .expect(200);
    await http
      .put('/v1/me/skills')
      .set(bob.auth)
      .send({ skills: ['C'] })
      .expect(200);
    const a = await http.get(`/v1/users/${alice.user.id}`).expect(200);
    expect(a.body.skills).toEqual(['A', 'B']);
  });

  it('refuses invalid names and unknown keys', async () => {
    const http = await start();
    const me = await member('bad');
    await http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: [''] })
      .expect(400);
    await http.put('/v1/me/skills').set(me.auth).send({ skills: 'React' }).expect(400);
    await http.put('/v1/me/skills').set(me.auth).send({ skills: [], userId: 'x' }).expect(400);
    await http.put('/v1/me/skills').set(me.auth).send({}).expect(400);
    await http.put('/v1/me/skills').send({ skills: [] }).expect(401);
  });

  it('rolls back whole when over the cap: the old list and the registry are untouched', async () => {
    const http = await start({ PROFILE_MAX_SKILLS: '2' });
    const me = await member('cap');
    await http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: ['Keep1', 'Keep2'] })
      .expect(200);
    const res = await http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: ['New1', 'New2', 'New3'] })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const profile = await http.get(`/v1/users/${me.user.id}`).expect(200);
    expect(profile.body.skills).toEqual(['Keep1', 'Keep2']);
    const terms = await db.selectFrom('terms').select('name').execute();
    expect(terms.map((t) => t.name).sort()).toEqual(['Keep1', 'Keep2']);
  });
});

describe('races, forced with a lock held on a second connection', () => {
  async function holdUserLock(userId: string): Promise<Connection> {
    const conn = await createConnection({ uri: testDatabaseUrl() });
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    return conn;
  }

  it('two creates at cap - 1: one 201, one 409', async () => {
    const http = await start({ PROFILE_MAX_SECTION_ITEMS: '2' });
    const me = await member('race-cap');
    await http.post('/v1/me/education').set(me.auth).send(SECTIONS[0]!.create).expect(201);

    const lock = await holdUserLock(me.user.id);
    const post = () =>
      http
        .post('/v1/me/education')
        .set(me.auth)
        .send(SECTIONS[0]!.create)
        .then((r) => r.status);
    const both = Promise.all([post(), post()]);
    await waitForLockWaiters(2);
    await lock.commit();
    await lock.end();

    expect((await both).sort()).toEqual([201, 409]);
    expect(await count('education', me.user.id)).toBe(2);
  });

  it('a reorder racing a create sees the new entry and answers 409 instead of dropping it', async () => {
    const http = await start();
    const me = await member('race-order');
    const a = (
      await http.post('/v1/me/education').set(me.auth).send(SECTIONS[0]!.create).expect(201)
    ).body.id;
    const b = (
      await http.post('/v1/me/education').set(me.auth).send(SECTIONS[0]!.create).expect(201)
    ).body.id;

    const lock = await holdUserLock(me.user.id);
    const pending = http
      .put('/v1/me/education/order')
      .set(me.auth)
      .send({ ids: [a, b] })
      .then((r) => r);
    await waitForLockWaiters(1);
    await lock.query(
      'INSERT INTO education (id, user_id, institution, degree, field, start_year, sort_order) VALUES (?,?,?,?,?,?,?)',
      [newId(), me.user.id, 'late', 'd', 'f', 2020, -5],
    );
    await lock.commit();
    await lock.end();

    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORDER_STALE');
    const order = await db
      .selectFrom('education')
      .select('institution')
      .where('userId', '=', me.user.id)
      .orderBy('sortOrder')
      .execute();
    expect(order[0]?.institution).toBe('late'); // untouched: the reorder wrote nothing
  });

  it('two skill replacements queue on the user lock; the result is exactly one caller’s list', async () => {
    const http = await start();
    const me = await member('race-skills');
    const lock = await holdUserLock(me.user.id);
    const put = (skills: string[]) =>
      http
        .put('/v1/me/skills')
        .set(me.auth)
        .send({ skills })
        .then((r) => r.status);
    const both = Promise.all([put(['A1', 'A2', 'A3']), put(['B1', 'B2'])]);
    await waitForLockWaiters(2);
    await lock.commit();
    await lock.end();

    expect(await both).toEqual([200, 200]);
    const skills = (
      await db
        .selectFrom('userSkills')
        .select('skillName')
        .where('userId', '=', me.user.id)
        .orderBy('sortOrder')
        .execute()
    ).map((r) => r.skillName);
    expect([
      ['A1', 'A2', 'A3'],
      ['B1', 'B2'],
    ]).toContainEqual(skills);
  });

  it('a create and a reorder racing the account’s deletion answer 404, not a foreign-key 500', async () => {
    const http = await start();
    const me = await member('race-delete');
    const lock = await holdUserLock(me.user.id);
    const create = http
      .post('/v1/me/education')
      .set(me.auth)
      .send(SECTIONS[0]!.create)
      .then((r) => r);
    const reorder = http
      .put('/v1/me/certifications/order')
      .set(me.auth)
      .send({ ids: [] })
      .then((r) => r);
    const skills = http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: ['X'] })
      .then((r) => r);
    await waitForLockWaiters(3);
    await lock.query('DELETE FROM users WHERE id = ?', [me.user.id]);
    await lock.commit();
    await lock.end();

    expect((await create).status).toBe(404);
    expect((await reorder).status).toBe(404);
    expect((await skills).status).toBe(404);
    expect(await count('education', me.user.id)).toBe(0);
  });

  it('two patches of one entry cannot each break the rule the other kept', async () => {
    const http = await start();
    const me = await member('race-patch');
    const made = await http
      .post('/v1/me/education')
      .set(me.auth)
      .send({ ...SECTIONS[0]!.create, startYear: 2020, endYear: 2025 })
      .expect(201);

    const rowLock = await createConnection({ uri: testDatabaseUrl() });
    await rowLock.beginTransaction();
    await rowLock.query('SELECT id FROM education WHERE id = ? FOR UPDATE', [made.body.id]);
    const patch = (body: object) =>
      http
        .patch(`/v1/me/education/${made.body.id}`)
        .set(me.auth)
        .send(body)
        .then((r) => r.status);
    // Each is valid against the stored 2020-2025 on its own; together they are not.
    const both = Promise.all([patch({ endYear: 2021 }), patch({ startYear: 2023 })]);
    await waitForLockWaiters(2);
    await rowLock.commit();
    await rowLock.end();

    expect((await both).sort()).toEqual([200, 400]);
    const row = await db
      .selectFrom('education')
      .select(['startYear', 'endYear'])
      .where('id', '=', made.body.id)
      .executeTakeFirstOrThrow();
    expect(row.endYear === null || row.endYear >= row.startYear).toBe(true);
  });
});

describe('rate limits', () => {
  it('give every new route its own per-caller budget', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '2', RATE_LIMIT_WINDOW_S: '60' });
    const me = await member('rl');
    const id = newId();
    const calls: [string, () => request.Test][] = [
      ['PUT /me/skills', () => http.put('/v1/me/skills').set(me.auth).send({ skills: [] })],
      ...SECTIONS.flatMap((s): [string, () => request.Test][] => [
        [`POST ${s.path}`, () => http.post(s.path).set(me.auth).send(s.create)],
        [`PATCH ${s.path}/:id`, () => http.patch(`${s.path}/${id}`).set(me.auth).send(s.patch)],
        [`DELETE ${s.path}/:id`, () => http.delete(`${s.path}/${id}`).set(me.auth)],
        [`PUT ${s.path}/order`, () => http.put(`${s.path}/order`).set(me.auth).send({ ids: [] })],
      ]),
    ];
    for (const [name, call] of calls) {
      await call();
      await call();
      expect((await call()).status, name).toBe(429);
    }
  });
});
