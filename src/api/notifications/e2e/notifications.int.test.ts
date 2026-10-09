import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { toJsonColumn } from '../../../core/db/json.js';
import { notificationParams } from '../../../core/validation/json-shapes.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig, testDatabase } from '../../../testing/database.js';
import { createProject, createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/**
 * M5 PR (a): the caller's notifications through the whole stack against MySQL
 * 8.4 -- scoping to the owner (S3), links computed from real ids (S12), and a
 * notification about something that is gone (docs/m5-plan.md §5).
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

type Type = 'team_invite' | 'team_accepted' | 'team_rejected' | 'team_left' | 'comment';

async function notify(
  userId: string,
  over: {
    type?: Type;
    projectId?: string | null;
    actorId?: string | null;
    isRead?: boolean;
    createdAt?: Date;
    id?: string;
    params?: boolean;
    title?: string;
  } = {},
) {
  const id = over.id ?? newId();
  const projectId = over.projectId === undefined ? newId() : over.projectId;
  await db
    .insertInto('notifications')
    .values({
      id,
      userId,
      type: over.type ?? 'team_invite',
      title: over.title ?? 'Team invitation',
      isRead: over.isRead ?? false,
      referenceId: projectId,
      referenceType: projectId === null ? null : 'project',
      params:
        over.params === false
          ? null
          : toJsonColumn(notificationParams, {
              actorId: over.actorId ?? null,
              actorName: 'Ani',
              projectId: projectId ?? 'none',
              projectTitle: 'Gradfolio',
              role: 'Dev',
            }),
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    })
    .execute();
  return id;
}

const at = (s: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, s));

interface Item {
  id: string;
  type: string;
  title: string;
  read: boolean;
  link: string | null;
  invite: { status: string } | null;
  params: { actorId: string | null; actorName: string; projectTitle: string } | null;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

describe('GET /v1/me/notifications', () => {
  it('lists only the caller’s, newest first', async () => {
    const http = await start();
    const alice = await member('alice');
    const bob = await member('bob');
    const a1 = await notify(alice.user.id, { createdAt: at(1) });
    const a2 = await notify(alice.user.id, { createdAt: at(3) });
    const a3 = await notify(alice.user.id, { createdAt: at(2) });
    await notify(bob.user.id, { createdAt: at(4) });

    const res = await http.get('/v1/me/notifications').set(alice.auth).expect(200);
    expect((res.body as Page).items.map((n) => n.id)).toEqual([a2, a3, a1]);
    expect((res.body as Page).nextCursor).toBeNull();
  });

  it('pages without repeating or skipping, ties on the second broken by id', async () => {
    const http = await start({ NOTIFICATIONS_PAGE_SIZE: '2' });
    const alice = await member('alice');
    const ids = [];
    for (let i = 0; i < 5; i++)
      ids.push(await notify(alice.user.id, { createdAt: at(i < 3 ? 1 : i) }));

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 5; guard++) {
      const res = await http
        .get('/v1/me/notifications')
        .query(cursor === null ? {} : { cursor })
        .set(alice.auth)
        .expect(200);
      const page = res.body as Page;
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((n) => n.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen.toSorted()).toEqual(ids.toSorted());
    expect(new Set(seen).size).toBe(5);
  });

  it.each([
    ['a cursor that is not one', { cursor: 'nope' }],
    ['a limit over the maximum', { limit: '51' }],
    ['a limit of zero', { limit: '0' }],
    ['an unknown key', { sort: 'oldest' }],
  ])('answers 400 for %s', async (_n, query) => {
    const http = await start();
    const alice = await member('alice');
    const res = await http.get('/v1/me/notifications').query(query).set(alice.auth).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('needs a token', async () => {
    const http = await start();
    await http.get('/v1/me/notifications').expect(401);
  });

  it('computes the link from the real project and reader, and never stores it', async () => {
    const http = await start();
    const owner = await member('owner');
    const invitee = await member('invitee');
    const stranger = await member('stranger');
    const { project: open } = await createProject(db, owner.user, { title: 'Open' });
    const { project: closed } = await createProject(db, owner.user, {
      title: 'Closed',
      isPublic: false,
    });
    await notify(invitee.user.id, { projectId: open.id, createdAt: at(1) });
    await notify(invitee.user.id, { projectId: closed.id, createdAt: at(2) });
    await notify(owner.user.id, { type: 'team_accepted', projectId: closed.id, createdAt: at(3) });
    await notify(stranger.user.id, {
      type: 'team_accepted',
      projectId: closed.id,
      createdAt: at(4),
    });

    const links = async (who: { auth: Record<string, string> }) =>
      ((await http.get('/v1/me/notifications').set(who.auth).expect(200)).body as Page).items.map(
        (n) => n.link,
      );
    // a pending invitee cannot open a private project; a public one opens for anyone
    expect(await links(invitee)).toEqual([null, `/projects/${open.id}`]);
    expect(await links(owner)).toEqual([`/projects/${closed.id}`]);
    // a notification must not hand its recipient a path to a project they cannot read
    expect(await links(stranger)).toEqual([null]);
  });

  it('shows the invitation’s current state, and "gone" once the invitation or project is', async () => {
    const http = await start();
    const owner = await member('owner');
    const invitee = await member('invitee');
    const { project } = await createProject(db, owner.user, { isPublic: false });
    const memberRow = async (status: 'pending' | 'accepted' | 'rejected') => {
      await db.deleteFrom('projectTeamMembers').where('projectId', '=', project.id).execute();
      await db
        .insertInto('projectTeamMembers')
        .values({ id: newId(), projectId: project.id, userId: invitee.user.id, name: 'i', status })
        .execute();
    };
    await notify(invitee.user.id, { projectId: project.id });
    const invite = async () =>
      ((await http.get('/v1/me/notifications').set(invitee.auth).expect(200)).body as Page)
        .items[0]!;

    expect((await invite()).invite).toEqual({ status: 'gone' }); // no row yet
    for (const status of ['pending', 'accepted', 'rejected'] as const) {
      await memberRow(status);
      expect((await invite()).invite).toEqual({ status });
    }
    await db.deleteFrom('projects').where('id', '=', project.id).execute();
    const gone = await invite();
    expect(gone.invite).toEqual({ status: 'gone' });
    expect(gone.link).toBeNull();
    // the saved names still render
    expect(gone.params).toMatchObject({ actorName: 'Ani', projectTitle: 'Gradfolio' });
  });

  it('has no invite object on other types, and reads an unexpected type as general', async () => {
    const http = await start();
    const alice = await member('alice');
    await notify(alice.user.id, { type: 'team_accepted', createdAt: at(1) });
    await notify(alice.user.id, { type: 'comment', createdAt: at(2) });
    const items = (
      (await http.get('/v1/me/notifications').set(alice.auth).expect(200)).body as Page
    ).items;
    expect(items.map((n) => [n.type, n.invite])).toEqual([
      ['general', null],
      ['team_accepted', null],
    ]);
  });

  it('renders when the actor’s account is gone or their profile is private, and links them only when visible', async () => {
    const http = await start();
    const alice = await member('alice');
    const open = await member('open');
    const hidden = await member('hidden', { isPublic: false });
    const gone = await member('gone');
    await notify(alice.user.id, { actorId: open.user.id, createdAt: at(1) });
    await notify(alice.user.id, { actorId: hidden.user.id, createdAt: at(2) });
    await notify(alice.user.id, { actorId: gone.user.id, createdAt: at(3) });
    await db.deleteFrom('users').where('id', '=', gone.user.id).execute();

    const items = (
      (await http.get('/v1/me/notifications').set(alice.auth).expect(200)).body as Page
    ).items;
    expect(items.map((n) => n.params?.actorId)).toEqual([null, null, open.user.id]);
    expect(items.every((n) => n.params?.actorName === 'Ani')).toBe(true);
  });

  it('shows a notification without params by its title alone', async () => {
    const http = await start();
    const alice = await member('alice');
    await notify(alice.user.id, { params: false, title: 'Old text', projectId: null });
    const [n] = ((await http.get('/v1/me/notifications').set(alice.auth).expect(200)).body as Page)
      .items;
    expect(n).toMatchObject({ params: null, title: 'Old text', link: null });
  });

  it('never carries a stored link or a private column', async () => {
    const http = await start();
    const alice = await member('alice', { email: 'alice-login@private.example', phone: '+374 1' });
    const owner = await member('owner');
    const { project } = await createProject(db, owner.user);
    const id = await notify(alice.user.id, { projectId: project.id });
    await db
      .updateTable('notifications')
      .set({ link: '/projects/proj_001' }) // a stale mock path
      .where('id', '=', id)
      .execute();
    const res = await http.get('/v1/me/notifications').set(alice.auth).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('proj_001');
    expect(text).not.toContain('private.example');
    expect(Object.keys((res.body as Page).items[0]!).toSorted()).toEqual(
      ['createdAt', 'id', 'invite', 'link', 'params', 'read', 'title', 'type'].toSorted(),
    );
  });
});

describe('unread count and marking read (S3)', () => {
  it('counts only the caller’s unread', async () => {
    const http = await start();
    const alice = await member('alice');
    const bob = await member('bob');
    await notify(alice.user.id);
    await notify(alice.user.id);
    await notify(alice.user.id, { isRead: true });
    await notify(bob.user.id);
    const res = await http.get('/v1/me/notifications/unread-count').set(alice.auth).expect(200);
    expect(res.body).toEqual({ count: 2 });
  });

  it('marks one read, idempotently', async () => {
    const http = await start();
    const alice = await member('alice');
    const id = await notify(alice.user.id);
    await http.post(`/v1/me/notifications/${id}/read`).set(alice.auth).expect(204);
    await http.post(`/v1/me/notifications/${id}/read`).set(alice.auth).expect(204);
    const res = await http.get('/v1/me/notifications/unread-count').set(alice.auth).expect(200);
    expect(res.body).toEqual({ count: 0 });
  });

  it('answers 404 for another user’s notification, changes nothing, and matches an unknown id', async () => {
    const http = await start();
    const alice = await member('alice');
    const bob = await member('bob');
    const bobs = await notify(bob.user.id);

    const res = await http.post(`/v1/me/notifications/${bobs}/read`).set(alice.auth).expect(404);
    const unknown = await http
      .post(`/v1/me/notifications/${newId()}/read`)
      .set(alice.auth)
      .expect(404);
    expect(res.body).toEqual(unknown.body);
    const row = await db
      .selectFrom('notifications')
      .select('isRead')
      .where('id', '=', bobs)
      .executeTakeFirstOrThrow();
    expect(row.isRead).toBe(false);
    // and bob can still do it himself
    await http.post(`/v1/me/notifications/${bobs}/read`).set(bob.auth).expect(204);
  });

  it('marks all of the caller’s read and nobody else’s', async () => {
    const http = await start();
    const alice = await member('alice');
    const bob = await member('bob');
    await notify(alice.user.id);
    await notify(alice.user.id);
    await notify(alice.user.id, { isRead: true });
    await notify(bob.user.id);

    const res = await http.post('/v1/me/notifications/read-all').set(alice.auth).expect(200);
    expect(res.body).toEqual({ updated: 2 });
    expect((await http.get('/v1/me/notifications/unread-count').set(alice.auth)).body).toEqual({
      count: 0,
    });
    expect((await http.get('/v1/me/notifications/unread-count').set(bob.auth)).body).toEqual({
      count: 1,
    });
    const again = await http.post('/v1/me/notifications/read-all').set(alice.auth).expect(200);
    expect(again.body).toEqual({ updated: 0 });
  });

  it('needs a token on every route', async () => {
    const http = await start();
    await http.get('/v1/me/notifications/unread-count').expect(401);
    await http.post('/v1/me/notifications/read-all').expect(401);
    await http.post(`/v1/me/notifications/${newId()}/read`).expect(401);
  });
});

describe('rate limits', () => {
  it.each([
    ['get', '/v1/me/notifications'],
    ['get', '/v1/me/notifications/unread-count'],
    ['post', '/v1/me/notifications/read-all'],
    ['post', `/v1/me/notifications/${newId()}/read`],
  ] as const)('%s %s answers 429 once the budget is spent', async (method, path) => {
    const http = await start({ RATE_LIMIT_DEFAULT: '2' });
    const alice = await member('alice');
    await http[method](path).set(alice.auth);
    await http[method](path).set(alice.auth);
    const res = await http[method](path).set(alice.auth).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });
});
