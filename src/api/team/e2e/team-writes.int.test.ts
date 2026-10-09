import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { captureLogs } from '../../../testing/app.js';
import { createProject } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import {
  addMember,
  countNotifications,
  db,
  membershipOf,
  membersOf,
  notificationsOf,
  person,
  startTeamApp,
} from '../../../testing/team.js';

/**
 * M5 PR (b): invite, external member, remove, accept, reject, leave and the
 * user lookup through the whole stack against MySQL 8.4 (docs/m5-plan.md §4).
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();

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
  const started = await startTeamApp(tenant, logs, env);
  app = started.app;
  return started.http;
}
const who = (label: string, over: Parameters<typeof person>[2] = {}) => person(tenant, label, over);

async function scene(over: { isPublic?: boolean; isDraft?: boolean } = {}) {
  const owner = await who('owner');
  const invitee = await who('invitee');
  const { project } = await createProject(db, owner.user, { title: 'Gradfolio', ...over });
  return { owner, invitee, project };
}

describe('POST /v1/projects/:id/team (invite)', () => {
  it('creates a pending membership and notifies the invitee in the same step', async () => {
    const http = await start();
    const { owner, invitee, project } = await scene({ isPublic: false });
    const res = await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: invitee.user.id, role: 'Backend' })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'invitee',
      role: 'Backend',
      status: 'pending',
      userId: invitee.user.id,
    });
    expect(await membershipOf(project.id, invitee.user.id)).toMatchObject({ status: 'pending' });

    const [n] = await notificationsOf(invitee.user.id);
    expect(n).toMatchObject({
      type: 'team_invite',
      referenceId: project.id,
      link: null,
      isRead: false,
    });
    expect(n!.params).toEqual({
      actorId: owner.user.id,
      actorName: 'owner',
      projectId: project.id,
      projectTitle: 'Gradfolio',
      role: 'Backend',
    });
    // and the invitee's bell sees it, with a live invitation and no way into the private project
    const list = await http.get('/v1/me/notifications').set(invitee.auth).expect(200);
    expect(list.body.items[0]).toMatchObject({
      type: 'team_invite',
      invite: { status: 'pending' },
      link: null,
    });
    await http.get(`/v1/projects/${project.id}`).set(invitee.auth).expect(404);
  });

  it('is 404 for everyone but the owner and writes nothing (S4)', async () => {
    const http = await start();
    const { owner, invitee, project } = await scene();
    const stranger = await who('stranger');
    const accepted = await who('accepted');
    const pending = await who('pending');
    await addMember(project.id, accepted.user.id, 'accepted');
    await addMember(project.id, pending.user.id, 'pending');
    const before = await membersOf(project.id);

    const unknown = await http
      .post(`/v1/projects/${newId()}/team`)
      .set(owner.auth)
      .send({ userId: invitee.user.id })
      .expect(404);
    for (const caller of [stranger, accepted, pending, invitee]) {
      const res = await http
        .post(`/v1/projects/${project.id}/team`)
        .set(caller.auth)
        .send({ userId: stranger.user.id })
        .expect(404);
      expect(res.body).toEqual(unknown.body);
      await http
        .post(`/v1/projects/${project.id}/team/external`)
        .set(caller.auth)
        .send({ name: 'X' })
        .expect(404);
    }
    expect(await membersOf(project.id)).toEqual(before);
    expect(await countNotifications()).toBe(0);
    await http
      .post(`/v1/projects/${project.id}/team`)
      .send({ userId: invitee.user.id })
      .expect(401);
  });

  it('refuses yourself, an unknown user and a private profile (the same 404), and a draft', async () => {
    const http = await start();
    const { owner, project } = await scene();
    const hidden = await who('hidden', { isPublic: false });
    const post = (b: object, p = project.id) =>
      http.post(`/v1/projects/${p}/team`).set(owner.auth).send(b);

    const self = await post({ userId: owner.user.id }).expect(400);
    expect(self.body.code).toBe('VALIDATION_FAILED');
    const unknown = await post({ userId: newId() }).expect(404);
    const priv = await post({ userId: hidden.user.id }).expect(404);
    expect(priv.body).toEqual(unknown.body);

    const { project: draft } = await createProject(db, owner.user, { isDraft: true });
    const other = await who('other');
    const res = await post({ userId: other.user.id }, draft.id).expect(409);
    expect(res.body.code).toBe('PROJECT_IS_DRAFT');
    expect(await membersOf(draft.id)).toEqual([]);

    for (const body of [
      {},
      { userId: '' },
      { userId: other.user.id, extra: 1 },
      { userId: other.user.id, role: 'x'.repeat(256) },
    ]) {
      expect((await post(body).expect(400)).body.code).toBe('VALIDATION_FAILED');
    }
    expect(await countNotifications()).toBe(0);
  });

  it('answers ALREADY_MEMBER for a second invitation, pending or accepted, and TEAM_FULL at the cap', async () => {
    const http = await start({ PROJECT_MAX_TEAM: '2' });
    const { owner, invitee, project } = await scene();
    const send = (userId: string) =>
      http.post(`/v1/projects/${project.id}/team`).set(owner.auth).send({ userId });

    await send(invitee.user.id).expect(201);
    expect((await send(invitee.user.id).expect(409)).body.code).toBe('ALREADY_MEMBER');
    await db
      .updateTable('projectTeamMembers')
      .set({ status: 'accepted' })
      .where('projectId', '=', project.id)
      .execute();
    expect((await send(invitee.user.id).expect(409)).body.code).toBe('ALREADY_MEMBER');

    const second = await who('second');
    await send(second.user.id).expect(201);
    const third = await who('third');
    expect((await send(third.user.id).expect(409)).body.code).toBe('TEAM_FULL');
    // externals count too
    await http
      .post(`/v1/projects/${project.id}/team/external`)
      .set(owner.auth)
      .send({ name: 'Ext' })
      .expect(409);
    expect(await countNotifications()).toBe(2); // one per successful invitation
  });

  it('invites a rejected user again by updating the same row, not inserting one (D6)', async () => {
    const http = await start();
    const { owner, invitee, project } = await scene();
    const first = await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: invitee.user.id, role: 'QA' })
      .expect(201);
    await http.post(`/v1/projects/${project.id}/team/me/reject`).set(invitee.auth).expect(200);
    expect(await membershipOf(project.id, invitee.user.id)).toMatchObject({ status: 'rejected' });

    const again = await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: invitee.user.id, role: 'Backend' })
      .expect(201);
    expect(again.body).toMatchObject({ id: first.body.id, status: 'pending', role: 'Backend' });
    expect(await membersOf(project.id)).toHaveLength(1);
    const types = (await notificationsOf(invitee.user.id)).map((n) => n.type);
    expect(types).toEqual(['team_invite', 'team_invite']);
    // a third invitation while pending is a conflict again
    await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: invitee.user.id })
      .expect(409);
  });
});

describe('POST /v1/projects/:id/team/external', () => {
  it('adds a named teammate, accepted, with no notification, shown on the project', async () => {
    const http = await start();
    const { owner, project } = await scene();
    const res = await http
      .post(`/v1/projects/${project.id}/team/external`)
      .set(owner.auth)
      .send({ name: '  Aram Manukyan ', role: 'QA' })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'Aram Manukyan',
      role: 'QA',
      status: 'accepted',
      userId: null,
    });
    expect(await countNotifications()).toBe(0);
    const detail = await http.get(`/v1/projects/${project.id}`).expect(200);
    expect(detail.body.team).toEqual([
      expect.objectContaining({ name: 'Aram Manukyan', userId: null }),
    ]);
    // two people may share a name: no uniqueness on named-only rows
    await http
      .post(`/v1/projects/${project.id}/team/external`)
      .set(owner.auth)
      .send({ name: 'Aram Manukyan' })
      .expect(201);
  });

  it.each([
    [{}],
    [{ name: '' }],
    [{ name: '   ' }],
    [{ name: 'x'.repeat(256) }],
    [{ name: 'A', userId: 'u' }],
  ])('rejects %j with 400', async (body) => {
    const http = await start();
    const { owner, project } = await scene();
    const res = await http
      .post(`/v1/projects/${project.id}/team/external`)
      .set(owner.auth)
      .send(body)
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('DELETE /v1/projects/:id/team/:memberId', () => {
  it('lets the owner remove any status, and closes the project to a removed member', async () => {
    const http = await start();
    const { owner, project } = await scene({ isPublic: false });
    const a = await who('a');
    const b = await who('b');
    await addMember(project.id, a.user.id, 'accepted');
    await addMember(project.id, b.user.id, 'pending');
    await addMember(project.id, null, 'accepted', 'External');
    await http.get(`/v1/projects/${project.id}`).set(a.auth).expect(200);

    for (const m of await membersOf(project.id)) {
      await http.delete(`/v1/projects/${project.id}/team/${m.id}`).set(owner.auth).expect(204);
    }
    expect(await membersOf(project.id)).toEqual([]);
    await http.get(`/v1/projects/${project.id}`).set(a.auth).expect(404);
  });

  it('is 404 for a non-owner and for another project’s member id, and changes nothing', async () => {
    const http = await start();
    const { owner, project } = await scene();
    const { project: mine } = await createProject(db, owner.user, { title: 'other project' });
    const stranger = await who('stranger');
    const teammate = await who('teammate');
    await addMember(project.id, teammate.user.id, 'accepted');
    await addMember(mine.id, null, 'accepted', 'elsewhere');
    const [elsewhere] = await membersOf(mine.id);
    const [here] = await membersOf(project.id);

    for (const caller of [stranger, teammate]) {
      await http.delete(`/v1/projects/${project.id}/team/${here!.id}`).set(caller.auth).expect(404);
    }
    // the owner owns both projects, but a member id only works under its own project
    await http
      .delete(`/v1/projects/${project.id}/team/${elsewhere!.id}`)
      .set(owner.auth)
      .expect(404);
    await http.delete(`/v1/projects/${project.id}/team/${newId()}`).set(owner.auth).expect(404);
    expect(await membersOf(project.id)).toHaveLength(1);
    expect(await membersOf(mine.id)).toHaveLength(1);
    await http.delete(`/v1/projects/${project.id}/team/${here!.id}`).expect(401);
  });
});

describe('accept and reject', () => {
  async function invited(over: { isPublic?: boolean } = {}) {
    const s = await scene(over);
    const http = await start();
    await http
      .post(`/v1/projects/${s.project.id}/team`)
      .set(s.owner.auth)
      .send({ userId: s.invitee.user.id, role: 'Dev' })
      .expect(201);
    return { ...s, http };
  }

  it('accepts: the member joins, the owner is told, the project opens to them', async () => {
    const { http, owner, invitee, project } = await invited({ isPublic: false });
    const res = await http
      .post(`/v1/projects/${project.id}/team/me/accept`)
      .set(invitee.auth)
      .expect(200);
    expect(res.body).toMatchObject({ status: 'accepted', userId: invitee.user.id, role: 'Dev' });

    const [n] = await notificationsOf(owner.user.id);
    expect(n).toMatchObject({ type: 'team_accepted', referenceId: project.id });
    expect(n!.params).toMatchObject({
      actorId: invitee.user.id,
      actorName: 'invitee',
      projectTitle: 'Gradfolio',
    });
    await http.get(`/v1/projects/${project.id}`).set(invitee.auth).expect(200);
    // the invitee's old notification now reads accepted, with a link
    const list = await http.get('/v1/me/notifications').set(invitee.auth).expect(200);
    expect(list.body.items[0]).toMatchObject({
      invite: { status: 'accepted' },
      link: `/projects/${project.id}`,
    });
  });

  it('rejects: the owner is told, the project stays closed', async () => {
    const { http, owner, invitee, project } = await invited({ isPublic: false });
    const res = await http
      .post(`/v1/projects/${project.id}/team/me/reject`)
      .set(invitee.auth)
      .expect(200);
    expect(res.body).toMatchObject({ status: 'rejected' });
    expect((await notificationsOf(owner.user.id))[0]).toMatchObject({ type: 'team_rejected' });
    await http.get(`/v1/projects/${project.id}`).set(invitee.auth).expect(404);
  });

  it('answers only while pending: INVITE_NOT_PENDING, and writes nothing more', async () => {
    const { http, owner, invitee, project } = await invited();
    await http.post(`/v1/projects/${project.id}/team/me/accept`).set(invitee.auth).expect(200);
    for (const action of ['accept', 'reject']) {
      const res = await http
        .post(`/v1/projects/${project.id}/team/me/${action}`)
        .set(invitee.auth)
        .expect(409);
      expect(res.body.code).toBe('INVITE_NOT_PENDING');
    }
    expect(await membershipOf(project.id, invitee.user.id)).toMatchObject({ status: 'accepted' });
    expect(await notificationsOf(owner.user.id)).toHaveLength(1);
  });

  it('is 404 for anyone who is not the invitee, the owner included', async () => {
    const { http, owner, invitee, project } = await invited();
    const stranger = await who('stranger');
    const unknown = await http
      .post(`/v1/projects/${newId()}/team/me/accept`)
      .set(invitee.auth)
      .expect(404);
    for (const caller of [owner, stranger]) {
      for (const action of ['accept', 'reject']) {
        const res = await http
          .post(`/v1/projects/${project.id}/team/me/${action}`)
          .set(caller.auth)
          .expect(404);
        expect(res.body.code).toBe(unknown.body.code);
      }
    }
    expect(await membershipOf(project.id, invitee.user.id)).toMatchObject({ status: 'pending' });
    expect(await notificationsOf(owner.user.id)).toEqual([]);
    await http.post(`/v1/projects/${project.id}/team/me/accept`).expect(401);
  });

  it('is 404 once the owner has removed the invitation', async () => {
    const { http, owner, invitee, project } = await invited();
    const m = await membershipOf(project.id, invitee.user.id);
    await http.delete(`/v1/projects/${project.id}/team/${m!.id}`).set(owner.auth).expect(204);
    await http.post(`/v1/projects/${project.id}/team/me/accept`).set(invitee.auth).expect(404);
    const list = await http.get('/v1/me/notifications').set(invitee.auth).expect(200);
    expect(list.body.items[0].invite).toEqual({ status: 'gone' });
  });
});

describe('DELETE /v1/projects/:id/team/me (leave)', () => {
  it('lets an accepted teammate leave, tells the owner and closes the project', async () => {
    const http = await start();
    const { owner, invitee, project } = await scene({ isPublic: false });
    await addMember(project.id, invitee.user.id, 'accepted');
    await http.delete(`/v1/projects/${project.id}/team/me`).set(invitee.auth).expect(204);
    expect(await membershipOf(project.id, invitee.user.id)).toBeUndefined();
    expect((await notificationsOf(owner.user.id))[0]).toMatchObject({ type: 'team_left' });
    await http.get(`/v1/projects/${project.id}`).set(invitee.auth).expect(404);
    // after leaving, an invitation is a plain INSERT again
    await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: invitee.user.id })
      .expect(201);
  });

  it('is 404 for a pending or rejected invitee, the owner and a stranger, and writes nothing', async () => {
    const http = await start();
    const { owner, project } = await scene();
    const pending = await who('pending');
    const rejected = await who('rejected');
    const stranger = await who('stranger');
    await addMember(project.id, pending.user.id, 'pending');
    await addMember(project.id, rejected.user.id, 'rejected');
    for (const caller of [pending, rejected, owner, stranger]) {
      await http.delete(`/v1/projects/${project.id}/team/me`).set(caller.auth).expect(404);
    }
    expect(await membersOf(project.id)).toHaveLength(2);
    expect(await countNotifications()).toBe(0);
    await http.delete(`/v1/projects/${project.id}/team/me`).expect(401);
  });
});

describe('GET /v1/users/lookup', () => {
  it('finds public profiles by the start of the name, never the caller or a private profile', async () => {
    const http = await start();
    const me = await who('Ani Caller', { email: 'ani@private.example' });
    await who('Anit Public', { headline: 'Dev' });
    await who('ANIKA upper');
    await who('Anita Hidden', { isPublic: false });
    await who('Bob Anita');
    const res = await http.get('/v1/users/lookup').query({ q: 'ani' }).set(me.auth).expect(200);
    const items = res.body.items as { name: string; headline: string | null }[];
    expect(items.map((i) => i.name)).toEqual(['ANIKA upper', 'Anit Public']);
    expect(Object.keys(res.body.items[0]).toSorted()).toEqual([
      'avatarUrl',
      'headline',
      'id',
      'name',
    ]);
    expect(JSON.stringify(res.body)).not.toContain('private.example');
  });

  it('treats % and _ as text, caps the page, and needs 3 characters', async () => {
    const http = await start();
    const me = await who('Caller');
    for (let i = 0; i < 10; i++) await who(`Zed ${i}`);
    expect(
      (await http.get('/v1/users/lookup').query({ q: 'Zed' }).set(me.auth).expect(200)).body.items,
    ).toHaveLength(8);
    expect(
      (await http.get('/v1/users/lookup').query({ q: '%%%' }).set(me.auth).expect(200)).body.items,
    ).toEqual([]);
    expect(
      (await http.get('/v1/users/lookup').query({ q: 'Z_d' }).set(me.auth).expect(200)).body.items,
    ).toEqual([]);
    for (const query of [{}, { q: 'ab' }, { q: '  a ' }, { q: 'abc', extra: '1' }]) {
      expect(
        (await http.get('/v1/users/lookup').query(query).set(me.auth).expect(400)).body.code,
      ).toBe('VALIDATION_FAILED');
    }
    await http.get('/v1/users/lookup').query({ q: 'Zed' }).expect(401);
  });

  it('is not shadowed by GET /users/:id', async () => {
    const http = await start();
    const me = await who('Caller');
    const res = await http.get('/v1/users/lookup').query({ q: 'zzz' }).set(me.auth).expect(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('has its own budget: it answers 429 while other routes still serve', async () => {
    const http = await start({ RATE_LIMIT_LOOKUP: '2' });
    const me = await who('Caller');
    await http.get('/v1/users/lookup').query({ q: 'abc' }).set(me.auth).expect(200);
    await http.get('/v1/users/lookup').query({ q: 'abc' }).set(me.auth).expect(200);
    const res = await http.get('/v1/users/lookup').query({ q: 'abc' }).set(me.auth).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    await http.get('/v1/me/notifications/unread-count').set(me.auth).expect(200);
  });
});

describe('rate limits on the team writes', () => {
  it.each([
    ['post', 'team', { userId: 'x' }],
    ['post', 'team/external', { name: 'n' }],
    ['delete', 'team/abc', undefined],
    ['post', 'team/me/accept', undefined],
    ['post', 'team/me/reject', undefined],
    ['delete', 'team/me', undefined],
  ] as const)(
    '%s /projects/:id/%s answers 429 once the budget is spent',
    async (method, path, body) => {
      const http = await start({ RATE_LIMIT_DEFAULT: '2' });
      const { owner, project } = await scene();
      const call = () => {
        const r = http[method](`/v1/projects/${project.id}/${path}`).set(owner.auth);
        return body ? r.send(body) : r;
      };
      await call();
      await call();
      expect((await call().expect(429)).body.code).toBe('RATE_LIMITED');
    },
  );
});
