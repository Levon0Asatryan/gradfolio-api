import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig, testDatabase } from '../../../testing/database.js';
import { createProject, createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/** M5 PR (a): GET /v1/projects/:id/team, the owner's view (S4: owner only, else 404). */

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

async function member(label: string, over: Parameters<typeof createUser>[1] = {}) {
  const sub = `auth0|${label}-${newId()}`;
  const user = await createUser(db, { auth0Id: sub, name: label, ...over });
  return { user, auth: { Authorization: `Bearer ${await tenant.sign({ sub })}` } };
}

const row = (
  projectId: string,
  userId: string | null,
  name: string,
  status: 'pending' | 'accepted' | 'rejected',
  sortOrder = 0,
) =>
  db
    .insertInto('projectTeamMembers')
    .values({ id: newId(), projectId, userId, name, role: 'Dev', status, sortOrder })
    .execute();

describe('GET /v1/projects/:id/team', () => {
  it('gives the owner every row in every status, in team order', async () => {
    const http = await start();
    const owner = await member('owner');
    const a = await member('a');
    const b = await member('b');
    const c = await member('c');
    const { project } = await createProject(db, owner.user);
    await row(project.id, a.user.id, 'A', 'accepted', 0);
    await row(project.id, b.user.id, 'B', 'pending', 1);
    await row(project.id, c.user.id, 'C', 'rejected', 2);
    await row(project.id, null, 'External', 'accepted', 3);

    const res = await http.get(`/v1/projects/${project.id}/team`).set(owner.auth).expect(200);
    expect(
      (res.body as { items: { name: string; status: string; userId: string | null }[] }).items.map(
        (m) => [m.name, m.status, m.userId],
      ),
    ).toEqual([
      ['a', 'accepted', a.user.id], // a linked member shows their live name
      ['b', 'pending', b.user.id],
      ['c', 'rejected', c.user.id],
      ['External', 'accepted', null],
    ]);
    expect(Object.keys(res.body.items[0]).toSorted()).toEqual(
      ['avatarUrl', 'createdAt', 'id', 'name', 'role', 'status', 'userId'].toSorted(),
    );
  });

  it('is 404 for everyone else: a stranger, every kind of member, and an anonymous caller is 401', async () => {
    const http = await start();
    const owner = await member('owner');
    const stranger = await member('stranger');
    const accepted = await member('accepted');
    const pending = await member('pending');
    const rejected = await member('rejected');
    const { project } = await createProject(db, owner.user);
    await row(project.id, accepted.user.id, 'x', 'accepted');
    await row(project.id, pending.user.id, 'y', 'pending');
    await row(project.id, rejected.user.id, 'z', 'rejected');

    const unknown = await http.get(`/v1/projects/${newId()}/team`).set(owner.auth).expect(404);
    for (const who of [stranger, accepted, pending, rejected]) {
      const res = await http.get(`/v1/projects/${project.id}/team`).set(who.auth).expect(404);
      expect(res.body).toEqual(unknown.body);
    }
    await http.get(`/v1/projects/${project.id}/team`).expect(401);
  });

  it('keeps a private profile’s account link and photo out of the list', async () => {
    const http = await start();
    const owner = await member('owner');
    const hidden = await member('hidden', {
      isPublic: false,
      avatarUrl: 'https://img.example/h.png',
    });
    const { project } = await createProject(db, owner.user);
    await row(project.id, hidden.user.id, 'Saved Name', 'accepted');
    const res = await http.get(`/v1/projects/${project.id}/team`).set(owner.auth).expect(200);
    expect(res.body.items[0]).toMatchObject({ name: 'Saved Name', userId: null, avatarUrl: null });
  });

  it('answers 429 once the budget is spent', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '2' });
    const owner = await member('owner');
    const { project } = await createProject(db, owner.user);
    await http.get(`/v1/projects/${project.id}/team`).set(owner.auth).expect(200);
    await http.get(`/v1/projects/${project.id}/team`).set(owner.auth).expect(200);
    await http.get(`/v1/projects/${project.id}/team`).set(owner.auth).expect(429);
  });
});
