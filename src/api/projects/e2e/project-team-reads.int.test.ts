import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig, testDatabase } from '../../../testing/database.js';
import { createProject, createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/**
 * M5 (Q4, 5.3): what an accepted team member may read, and which lists a team
 * project appears in. Membership widens a *direct read* of a non-draft project;
 * it never puts a private project into anyone's discovery lists.
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
});
afterEach(async () => {
  logs.clear();
  await app?.close();
  app = undefined;
});

async function start() {
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'warn',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
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

type Status = 'pending' | 'accepted' | 'rejected';
const join = (projectId: string, userId: string, status: Status) =>
  db
    .insertInto('projectTeamMembers')
    .values({ id: newId(), projectId, userId, name: 'm', status })
    .execute();

interface Page {
  items: { title: string; role: string; isOwner: boolean }[];
}
const titles = (body: unknown) => (body as Page).items.map((p) => p.title).toSorted();

describe('GET /v1/projects/:id as a team member (Q4)', () => {
  const PRIVATE = { isPublic: false };
  const DRAFT = { isPublic: false, isDraft: true };

  it.each([
    ['accepted', PRIVATE, 200],
    ['pending', PRIVATE, 404],
    ['rejected', PRIVATE, 404],
    ['accepted', DRAFT, 404],
    ['accepted', { isPublic: true, isDraft: true }, 404],
  ] as const)('a %s member of a %j project gets %i', async (status, state, expected) => {
    const http = await start();
    const owner = await member('owner');
    const teammate = await member('teammate');
    const { project } = await createProject(db, owner.user, state);
    await join(project.id, teammate.user.id, status);
    const res = await http.get(`/v1/projects/${project.id}`).set(teammate.auth).expect(expected);
    if (expected === 404) {
      const unknown = await http.get(`/v1/projects/${newId()}`).set(teammate.auth).expect(404);
      expect(res.body).toEqual(unknown.body);
    } else {
      expect(res.body).toMatchObject({ id: project.id, isOwner: false });
    }
  });

  it('does not open a private project to a stranger or anonymous, member of a different project or not', async () => {
    const http = await start();
    const owner = await member('owner');
    const teammate = await member('teammate');
    const stranger = await member('stranger');
    const { project } = await createProject(db, owner.user, PRIVATE);
    const other = await createProject(db, owner.user, { title: 'other' });
    await join(other.project.id, teammate.user.id, 'accepted'); // member of ANOTHER project
    await join(project.id, teammate.user.id, 'rejected');
    await http.get(`/v1/projects/${project.id}`).set(stranger.auth).expect(404);
    await http.get(`/v1/projects/${project.id}`).set(teammate.auth).expect(404);
    await http.get(`/v1/projects/${project.id}`).expect(404);
  });

  it('closes again when the member is removed or leaves', async () => {
    const http = await start();
    const owner = await member('owner');
    const teammate = await member('teammate');
    const { project } = await createProject(db, owner.user, PRIVATE);
    await join(project.id, teammate.user.id, 'accepted');
    await http.get(`/v1/projects/${project.id}`).set(teammate.auth).expect(200);
    await db.deleteFrom('projectTeamMembers').where('projectId', '=', project.id).execute();
    await http.get(`/v1/projects/${project.id}`).set(teammate.auth).expect(404);
  });

  it('shows a member’s renamed account name, and the saved name once their profile is private', async () => {
    const http = await start();
    const owner = await member('owner');
    const teammate = await member('Old Name');
    const { project } = await createProject(db, owner.user);
    await db
      .insertInto('projectTeamMembers')
      .values({
        id: newId(),
        projectId: project.id,
        userId: teammate.user.id,
        name: 'Old Name',
        status: 'accepted',
      })
      .execute();
    await db
      .updateTable('users')
      .set({ name: 'New Name' })
      .where('id', '=', teammate.user.id)
      .execute();
    const live = await http.get(`/v1/projects/${project.id}`).expect(200);
    expect(live.body.team[0]).toMatchObject({ name: 'New Name', userId: teammate.user.id });
    await db
      .updateTable('users')
      .set({ isPublic: false })
      .where('id', '=', teammate.user.id)
      .execute();
    const hidden = await http.get(`/v1/projects/${project.id}`).expect(200);
    expect(hidden.body.team[0]).toMatchObject({ name: 'Old Name', userId: null, avatarUrl: null });
  });
});

describe('team projects in lists (5.3)', () => {
  async function scene() {
    const owner = await member('owner');
    const teammate = await member('teammate');
    const make = (title: string, state: object, status?: Status) =>
      createProject(db, owner.user, { title, ...state }).then(async (c) => {
        if (status) await join(c.project.id, teammate.user.id, status);
        return c;
      });
    await make('published', {}, 'accepted');
    await make('private', { isPublic: false }, 'accepted');
    await make('draft', { isDraft: true }, 'accepted');
    await make('pending', {}, 'pending');
    await make('rejected', {}, 'rejected');
    await make('not a member', {});
    await createProject(db, teammate.user, { title: 'mine' });
    await createProject(db, teammate.user, { title: 'my private', isPublic: false });
    return { owner, teammate };
  }

  it('lists accepted, published team projects on a user’s page, with role member', async () => {
    const http = await start();
    const { owner, teammate } = await scene();
    const res = await http.get(`/v1/users/${teammate.user.id}/projects`).expect(200);
    expect(titles(res.body)).toEqual(['mine', 'published']);
    const roles = Object.fromEntries((res.body as Page).items.map((p) => [p.title, p.role]));
    expect(roles).toEqual({ mine: 'owner', published: 'member' });
    // the teammate seeing their own page still gets published ones only
    const own = await http
      .get(`/v1/users/${teammate.user.id}/projects`)
      .set(teammate.auth)
      .expect(200);
    expect(titles(own.body)).toEqual(['mine', 'published']);
    // the owner's page does not gain the teammate's work
    const ownerPage = await http.get(`/v1/users/${owner.user.id}/projects`).expect(200);
    expect(titles(ownerPage.body)).not.toContain('mine');
  });

  it('lists a private (never draft) team project in the member’s own list only', async () => {
    const http = await start();
    const { owner, teammate } = await scene();
    const mine = await http.get('/v1/me/projects').set(teammate.auth).expect(200);
    expect(titles(mine.body)).toEqual(['mine', 'my private', 'private', 'published']);
    const flags = Object.fromEntries(
      (mine.body as Page).items.map((p) => [p.title, [p.role, p.isOwner]]),
    );
    expect(flags.private).toEqual(['member', false]);
    expect(flags.mine).toEqual(['owner', true]);

    const priv = await http
      .get('/v1/me/projects')
      .query({ state: 'private' })
      .set(teammate.auth)
      .expect(200);
    expect(titles(priv.body)).toEqual(['my private', 'private']);
    const draft = await http
      .get('/v1/me/projects')
      .query({ state: 'draft' })
      .set(teammate.auth)
      .expect(200);
    expect(titles(draft.body)).toEqual([]);

    // the owner's own list is unchanged by teammates
    const ownerList = await http.get('/v1/me/projects').set(owner.auth).expect(200);
    expect(titles(ownerList.body)).not.toContain('mine');
  });

  it('never makes membership a way into the owner’s private projects through discovery', async () => {
    const http = await start();
    const { owner, teammate } = await scene();
    const res = await http
      .get(`/v1/users/${owner.user.id}/projects`)
      .set(teammate.auth)
      .expect(200);
    expect(titles(res.body)).not.toContain('private');
    expect(titles(res.body)).not.toContain('draft');
  });

  it('shows team projects on the profile: private only to the member, published to all, pending never', async () => {
    const http = await start();
    const { teammate } = await scene();
    const viewer = await member('viewer');
    const profileTitles = async (auth: Record<string, string> | undefined) => {
      const req = http.get(`/v1/users/${teammate.user.id}`);
      const body = (await (auth ? req.set(auth) : req).expect(200)).body as {
        projects: { title: string }[];
      };
      return body.projects.map((p) => p.title).toSorted();
    };
    expect(await profileTitles(undefined)).toEqual(['mine', 'published']);
    expect(await profileTitles(viewer.auth)).toEqual(['mine', 'published']);
    expect(await profileTitles(teammate.auth)).toEqual([
      'mine',
      'my private',
      'private',
      'published',
    ]);
  });
});
