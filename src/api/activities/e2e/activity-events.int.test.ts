import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig, testDatabase } from '../../../testing/database.js';
import { createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/**
 * Which events write an activity, and that each is one transaction with its
 * event (docs/m5-plan.md §8). The activity writer is wrapped, not replaced:
 * `before` throws instead of writing (the event has happened, the activity has
 * not), `after` writes and then throws (both have). Either way the response is
 * 500 and the database must look as if the event never happened.
 */

const control = vi.hoisted((): { mode: 'pass' | 'before' | 'after' } => ({ mode: 'pass' }));

vi.mock('../repositories/activity-write.repository.js', async (original) => {
  const real = await original<typeof import('../repositories/activity-write.repository.js')>();
  return {
    ...real,
    recordActivity: async (...args: Parameters<typeof real.recordActivity>) => {
      if (control.mode === 'before') throw new Error('forced failure before the activity');
      await real.recordActivity(...args);
      if (control.mode === 'after') throw new Error('forced failure after the activity');
    },
  };
});

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();
const db = testDatabase();

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
beforeEach(async () => {
  control.mode = 'pass';
  await db.deleteFrom('users').execute();
  await db.deleteFrom('terms').execute();
});
afterEach(async () => {
  control.mode = 'pass';
  logs.clear();
  await app?.close();
  app = undefined;
});

async function start() {
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'fatal',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
    }),
    undefined,
    { logs },
  );
  return request(app.getHttpServer());
}

async function alice() {
  const sub = `auth0|alice-${newId()}`;
  const user = await createUser(db, { auth0Id: sub, name: 'alice' });
  return { user, auth: { Authorization: `Bearer ${await tenant.sign({ sub })}` } };
}

const feed = (userId: string) =>
  db
    .selectFrom('activities')
    .select(['type', 'translationKey', 'translationParams'])
    .where('userId', '=', userId)
    .execute()
    // Activities within one second have no stored order; compare as a set.
    .then((rows) => rows.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
const projectCount = async () =>
  Number(
    (
      await db
        .selectFrom('projects')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );
const skillList = (userId: string) =>
  db
    .selectFrom('userSkills')
    .select('skillName')
    .where('userId', '=', userId)
    .orderBy('sortOrder')
    .execute();

describe('the events that write an activity', () => {
  it('create: projectCreated with the id and the title, nothing else', async () => {
    const http = await start();
    const a = await alice();
    const res = await http
      .post('/v1/projects')
      .set(a.auth)
      .send({ title: 'Gradfolio', descriptionHtml: '<p>secret plan</p>' })
      .expect(201);
    expect(await feed(a.user.id)).toEqual([
      {
        type: 'project',
        translationKey: 'projectCreated',
        translationParams: { projectId: res.body.id, name: 'Gradfolio' },
      },
    ]);
  });

  it('update: projectPublished only on the change from draft to published', async () => {
    const http = await start();
    const a = await alice();
    const id = (
      await http.post('/v1/projects').set(a.auth).send({ title: 'P', isDraft: true }).expect(201)
    ).body.id as string;
    await http.patch(`/v1/projects/${id}`).set(a.auth).send({ title: 'P2' }).expect(200);
    expect((await feed(a.user.id)).map((f) => f.translationKey)).toEqual(['projectCreated']);

    await http.patch(`/v1/projects/${id}`).set(a.auth).send({ isDraft: false }).expect(200);
    await http.patch(`/v1/projects/${id}`).set(a.auth).send({ title: 'P3' }).expect(200);
    const keys = await feed(a.user.id);
    expect(keys.map((f) => f.translationKey)).toEqual(['projectCreated', 'projectPublished']);
    expect(keys[1]!.translationParams).toEqual({ projectId: id, name: 'P2' });
  });

  it('delete: projectDeleted with the name it had, no id', async () => {
    const http = await start();
    const a = await alice();
    const id = (await http.post('/v1/projects').set(a.auth).send({ title: 'Gone' }).expect(201))
      .body.id as string;
    await http.delete(`/v1/projects/${id}`).set(a.auth).expect(204);
    const rows = await feed(a.user.id);
    expect(rows.at(-1)).toEqual({
      type: 'project',
      translationKey: 'projectDeleted',
      translationParams: { name: 'Gone' },
    });
  });

  it('skills: one new skill is named, several are counted, a re-save or a removal is silent', async () => {
    const http = await start();
    const a = await alice();
    const put = (skills: string[]) =>
      http.put('/v1/me/skills').set(a.auth).send({ skills }).expect(200);
    await put(['Docker']);
    await put(['docker', 'Docker ']); // the same skill, any case
    await put([]); // removal
    await put(['Go', 'Rust', 'SQL']);
    await put(['Go', 'Rust', 'SQL', 'C']);
    expect(
      (await feed(a.user.id)).map((f) => [f.type, f.translationKey, f.translationParams]),
    ).toEqual([
      ['profile', 'newSkill', { skill: 'C' }],
      ['profile', 'newSkill', { skill: 'Docker' }],
      ['profile', 'skillsAdded', { count: 3 }],
    ]);
  });
});

describe.each(['before', 'after'] as const)('a failure %s the activity is written', (mode) => {
  it('create: no project, no activity', async () => {
    const http = await start();
    const a = await alice();
    control.mode = mode;
    await http.post('/v1/projects').set(a.auth).send({ title: 'X' }).expect(500);
    expect(await projectCount()).toBe(0);
    expect(await feed(a.user.id)).toEqual([]);
  });

  it('publish: the project stays a draft, no activity', async () => {
    const http = await start();
    const a = await alice();
    const id = (
      await http.post('/v1/projects').set(a.auth).send({ title: 'D', isDraft: true }).expect(201)
    ).body.id as string;
    const before = await feed(a.user.id);
    control.mode = mode;
    await http.patch(`/v1/projects/${id}`).set(a.auth).send({ isDraft: false }).expect(500);
    const row = await db
      .selectFrom('projects')
      .select('isDraft')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.isDraft).toBe(true);
    expect(await feed(a.user.id)).toEqual(before);
  });

  it('delete: the project is still there, no activity', async () => {
    const http = await start();
    const a = await alice();
    const id = (await http.post('/v1/projects').set(a.auth).send({ title: 'Keep' }).expect(201))
      .body.id as string;
    const before = await feed(a.user.id);
    control.mode = mode;
    await http.delete(`/v1/projects/${id}`).set(a.auth).expect(500);
    expect(await projectCount()).toBe(1);
    expect(await feed(a.user.id)).toEqual(before);
  });

  it('skills: the old list stays, no activity', async () => {
    const http = await start();
    const a = await alice();
    await http
      .put('/v1/me/skills')
      .set(a.auth)
      .send({ skills: ['Go'] })
      .expect(200);
    const before = await feed(a.user.id);
    control.mode = mode;
    await http
      .put('/v1/me/skills')
      .set(a.auth)
      .send({ skills: ['Go', 'Rust'] })
      .expect(500);
    expect((await skillList(a.user.id)).map((s) => s.skillName)).toEqual(['Go']);
    expect(await feed(a.user.id)).toEqual(before);
  });
});
