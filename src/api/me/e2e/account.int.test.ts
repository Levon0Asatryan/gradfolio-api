import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'kysely';
import { createConnection } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testConfig, testDatabase, testDatabaseUrl } from '../../../testing/database.js';
import { createProfile, createProject } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/** DELETE /v1/me through the whole stack against MySQL 8.4 (docs/m3-plan.md 3.6). */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();
const db = testDatabase();

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
beforeEach(async () => {
  logs.clear();
  await db.deleteFrom('users').execute();
  await db.deleteFrom('terms').execute();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(env: NodeJS.ProcessEnv = {}) {
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'info',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
      ...env,
    }),
    undefined,
    { logs },
  );
  return request(app.getHttpServer());
}

type Account = Awaited<ReturnType<typeof account>>;

async function account(label: string) {
  const sub = `auth0|${label}-${newId()}`;
  const { user } = await createProfile(db, {
    auth0Id: sub,
    name: label,
    email: `${label}@x.example`,
  });
  return { user, sub, auth: { Authorization: `Bearer ${await tenant.sign({ sub })}` } };
}

const TABLES = [
  'users',
  'education',
  'experience',
  'certifications',
  'user_skills',
  'projects',
  'project_attachments',
  'project_team_members',
  'project_tags',
  'project_technologies',
  'integrations',
  'activities',
  'notifications',
  'terms',
] as const;

async function counts() {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql.table(t)}`.execute(
      db,
    );
    out[t] = Number(rows[0]!.n);
  }
  return out;
}

/** Everything a user can own, plus a membership on someone else's project. */
async function populate(owner: Account, other: Account) {
  const own = await createProject(db, owner.user, {
    title: 'own',
    tags: ['t1'],
    technologies: ['ts'],
    attachments: [{ type: 'link', url: 'https://a.example', title: 'a' }],
  });
  await db
    .insertInto('projectTeamMembers')
    .values({
      id: newId(),
      projectId: own.project.id,
      userId: other.user.id,
      name: 'Other',
      status: 'accepted',
    })
    .execute();
  const theirs = await createProject(db, other.user, { title: 'theirs' });
  await db
    .insertInto('projectTeamMembers')
    .values({
      id: newId(),
      projectId: theirs.project.id,
      userId: owner.user.id,
      name: 'Leaving Person',
      role: 'developer',
      avatarUrl: 'https://photos.example/leaving.png',
      status: 'accepted',
    })
    .execute();
  await db
    .insertInto('projectTeamMembers')
    .values({
      id: newId(),
      projectId: theirs.project.id,
      userId: other.user.id,
      name: 'Staying Person',
      avatarUrl: 'https://photos.example/staying.png',
      status: 'accepted',
    })
    .execute();
  await db
    .insertInto('integrations')
    .values({
      id: newId(),
      userId: owner.user.id,
      integrationType: 'github',
      status: 'connected',
      accessToken: 'tok',
      refreshToken: 'ref',
    })
    .execute();
  await db
    .insertInto('notifications')
    .values({ id: newId(), userId: owner.user.id, type: 'general', title: 't', message: 'm' })
    .execute();
  await db
    .insertInto('notifications')
    .values({
      id: newId(),
      userId: other.user.id,
      type: 'general',
      title: 'for other',
      message: 'm',
    })
    .execute();
  await db
    .insertInto('activities')
    .values({ id: newId(), userId: owner.user.id, type: 'profile', translationKey: 'k' })
    .execute();
  return { own, theirs };
}

describe('DELETE /v1/me', () => {
  it('removes the account and everything under it, and nothing of anyone else’s', async () => {
    const http = await start();
    const alice = await account('alice');
    const bob = await account('bob');
    const { theirs } = await populate(alice, bob);

    const before = await counts();
    const bobEducation = await db
      .selectFrom('education')
      .select('id')
      .where('userId', '=', bob.user.id)
      .execute();
    const bobSkills = await db
      .selectFrom('userSkills')
      .select('id')
      .where('userId', '=', bob.user.id)
      .execute();

    await http.delete('/v1/me').set(alice.auth).expect(204);

    const after = await counts();
    // alice owned 1 user, 1 education, 1 experience, 1 certification, 2 skills,
    // 1 project (+1 attachment, tag, technology, 1 team row of bob's), 1
    // integration, 1 notification, 1 activity; her team row on bob's project stays.
    expect(after).toEqual({
      users: before.users! - 1,
      education: before.education! - 1,
      experience: before.experience! - 1,
      certifications: before.certifications! - 1,
      user_skills: before.user_skills! - 2,
      projects: before.projects! - 1,
      project_attachments: before.project_attachments! - 1,
      project_team_members: before.project_team_members! - 1,
      project_tags: before.project_tags! - 1,
      project_technologies: before.project_technologies! - 1,
      integrations: before.integrations! - 1,
      activities: before.activities! - 1,
      notifications: before.notifications! - 1,
      terms: before.terms!, // the shared registry is not a user's
    });
    expect(
      await db.selectFrom('users').select('id').where('id', '=', alice.user.id).execute(),
    ).toEqual([]);

    // Bob and bob's rows are untouched.
    expect(
      await db.selectFrom('education').select('id').where('userId', '=', bob.user.id).execute(),
    ).toEqual(bobEducation);
    expect(
      await db.selectFrom('userSkills').select('id').where('userId', '=', bob.user.id).execute(),
    ).toEqual(bobSkills);
    expect(
      (
        await db
          .selectFrom('notifications')
          .select('title')
          .where('userId', '=', bob.user.id)
          .execute()
      ).map((n) => n.title),
    ).toEqual(['for other']);
    expect(
      (await db.selectFrom('projects').select('id').where('id', '=', theirs.project.id).execute())
        .length,
    ).toBe(1);
    await http.get(`/v1/users/${bob.user.id}`).expect(200);
  });

  it('leaves the name and role on other people’s projects, without the photo or the account link', async () => {
    const http = await start();
    const alice = await account('alice');
    const bob = await account('bob');
    const { theirs } = await populate(alice, bob);
    await http.delete('/v1/me').set(alice.auth).expect(204);

    const rows = await db
      .selectFrom('projectTeamMembers')
      .select(['userId', 'name', 'role', 'avatarUrl', 'status'])
      .where('projectId', '=', theirs.project.id)
      .orderBy('name')
      .execute();
    expect(rows).toEqual([
      {
        userId: null,
        name: 'Leaving Person',
        role: 'developer',
        avatarUrl: null,
        status: 'accepted',
      },
      // someone else's membership on the same project is untouched, photo included
      {
        userId: bob.user.id,
        name: 'Staying Person',
        role: null,
        avatarUrl: 'https://photos.example/staying.png',
        status: 'accepted',
      },
    ]);
  });

  it('makes the profile unreadable at once', async () => {
    const http = await start();
    const alice = await account('alice');
    await http.get(`/v1/users/${alice.user.id}`).expect(200);
    await http.delete('/v1/me').set(alice.auth).expect(204);
    await http.get(`/v1/users/${alice.user.id}`).expect(404);
  });

  it('writes the started line before the change and the completed line after, with the id only', async () => {
    const http = await start();
    const alice = await account('alice');
    await http.delete('/v1/me').set(alice.auth).expect(204);
    const lines = logs.lines().filter((l) => String(l.msg).startsWith('account deletion'));
    expect(lines.map((l) => l.msg)).toEqual([
      'account deletion started',
      'account deletion completed',
    ]);
    expect(lines.every((l) => l.userId === alice.user.id)).toBe(true);
    expect(logs.text()).not.toContain('alice@x.example');
  });

  it('records the start even when the deletion then finds nothing: 404, no "completed"', async () => {
    const http = await start();
    const alice = await account('alice');
    await http.get('/v1/me').set(alice.auth).expect(200); // the row exists
    const conn = await createConnection({ uri: testDatabaseUrl() });
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [alice.user.id]);
    const pending = http
      .delete('/v1/me')
      .set(alice.auth)
      .then((r) => r);
    await waitForLockWaiters(1);
    await conn.query('DELETE FROM users WHERE id = ?', [alice.user.id]);
    await conn.commit();
    await conn.end();

    expect((await pending).status).toBe(404);
    const msgs = logs.lines().map((l) => l.msg);
    expect(msgs).toContain('account deletion started');
    expect(msgs).not.toContain('account deletion completed');
  });

  it('waits for a write in flight, then deletes that row too: no orphan, no foreign-key error', async () => {
    const http = await start();
    const alice = await account('alice');
    await db.deleteFrom('education').execute();
    const conn = await createConnection({ uri: testDatabaseUrl() });
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [alice.user.id]);
    const pending = http
      .delete('/v1/me')
      .set(alice.auth)
      .then((r) => r);
    await waitForLockWaiters(1);
    await conn.query(
      'INSERT INTO education (id, user_id, institution, degree, field, start_year) VALUES (?,?,?,?,?,?)',
      [newId(), alice.user.id, 'late', 'd', 'f', 2020],
    );
    await conn.commit();
    await conn.end();

    expect((await pending).status).toBe(204);
    expect(await db.selectFrom('education').select('id').execute()).toEqual([]);
  });

  it('takes the user row before the team rows: a writer that holds the user row and wants a team row does not deadlock with it', async () => {
    const http = await start();
    const alice = await account('alice');
    const bob = await account('bob');
    await populate(alice, bob); // alice has a team row on bob's project

    // A write that follows the documented order (user row, then child rows).
    const writer = await createConnection({ uri: testDatabaseUrl() });
    await writer.beginTransaction();
    await writer.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [alice.user.id]);
    const deletion = http
      .delete('/v1/me')
      .set(alice.auth)
      .then((r) => r);
    await waitForLockWaiters(1); // the deletion is queued on the user row
    // Needs the team row. If the deletion had already locked it (team rows
    // first), this would close the cycle and InnoDB would abort one side (1213).
    await writer.query('SELECT id FROM project_team_members WHERE user_id = ? FOR UPDATE', [
      alice.user.id,
    ]);
    await writer.commit();
    await writer.end();

    expect((await deletion).status).toBe(204);
  });

  it('needs a token, and deletes only the caller’s account whoever else exists', async () => {
    const http = await start();
    await http.delete('/v1/me').expect(401);
    const alice = await account('alice');
    const bob = await account('bob');
    await http.delete('/v1/me').set(bob.auth).expect(204);
    expect((await db.selectFrom('users').select('id').execute()).map((u) => u.id)).toEqual([
      alice.user.id,
    ]);
  });

  it('a token that is still valid creates a new, empty account on its next request', async () => {
    const http = await start();
    const alice = await account('alice');
    await http.delete('/v1/me').set(alice.auth).expect(204);
    const again = await http.get('/v1/me').set(alice.auth).expect(200);
    expect(again.body.id).not.toBe(alice.user.id);
    expect(again.body.onboarded).toBe(false);
    const profile = await http.get(`/v1/users/${again.body.id}`).expect(200);
    expect(profile.body).toMatchObject({ education: [], skills: [], projects: [] });
  });

  it('is rate limited per caller', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '2' });
    const alice = await account('alice');
    await http.delete('/v1/me').set(alice.auth);
    await http.delete('/v1/me').set(alice.auth);
    expect((await http.delete('/v1/me').set(alice.auth)).status).toBe(429);
  });
});
