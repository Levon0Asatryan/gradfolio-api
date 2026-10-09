import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Database } from '../../../core/db/database.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbService } from '../../../core/db/db.service.js';
import { newId } from '../../../core/db/ids.js';
import { captureLogs } from '../../../testing/app.js';
import { createProject } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { addMember, db, person, startTeamApp } from '../../../testing/team.js';

/** M5 5.8: GET /v1/me/teams -- the caller's owned, joined, incoming and outgoing teams in one call. */

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

interface Section<T> {
  items: T[];
  nextCursor: string | null;
}
interface Teams {
  owned: Section<{
    id: string;
    title: string;
    members: { name: string; status: string; userId: string | null; avatarUrl: string | null }[];
  }>;
  member: Section<{
    id: string;
    title: string;
    role: string | null;
    owner: { id: string; name: string };
    team: { name: string; status: string }[];
  }>;
  incoming: Section<{
    id: string;
    project: { id: string; title: string };
    invitedBy: { id: string | null; name: string };
    role: string | null;
  }>;
  outgoing: Section<{
    id: string;
    project: { id: string; title: string };
    invitee: { id: string | null; name: string; avatarUrl: string | null };
    role: string | null;
  }>;
}
const names = (xs: { title: string }[]) => xs.map((x) => x.title).toSorted();

async function scene() {
  const owner = await who('owner');
  const a = await who('a-accepted');
  const b = await who('b-pending');
  const c = await who('c-rejected');
  const x = await who('x-stranger');
  const { project: p1 } = await createProject(db, owner.user, {
    title: 'P1 private',
    isPublic: false,
    descriptionHtml: '<p>secret plan</p>',
  });
  const { project: p2 } = await createProject(db, owner.user, { title: 'P2 public' });
  const { project: draft } = await createProject(db, owner.user, {
    title: 'P3 draft',
    isDraft: true,
  });
  await createProject(db, owner.user, { title: 'P4 no team' });
  await addMember(p1.id, a.user.id, 'accepted');
  await addMember(p1.id, null, 'accepted', 'External Eve');
  await addMember(p1.id, c.user.id, 'rejected');
  await addMember(p2.id, b.user.id, 'pending');
  await addMember(p1.id, b.user.id, 'pending');
  await addMember(draft.id, a.user.id, 'accepted'); // a draft is never shown to a member
  return { owner, a, b, c, x, p1, p2, draft };
}

describe('GET /v1/me/teams', () => {
  it('the owner sees the projects with members, every member and status; not a project without a team', async () => {
    const http = await start();
    const { owner } = await scene();
    const res = await http.get('/v1/me/teams').set(owner.auth).expect(200);
    const t = res.body as Teams;
    expect(names(t.owned.items)).toEqual(['P1 private', 'P2 public', 'P3 draft']);
    const p1 = t.owned.items.find((p) => p.title === 'P1 private')!;
    expect(p1.members.map((m) => [m.name, m.status]).toSorted()).toEqual([
      ['External Eve', 'accepted'],
      ['a-accepted', 'accepted'],
      ['b-pending', 'pending'],
      ['c-rejected', 'rejected'],
    ]);
    expect(p1.members.find((m) => m.name === 'External Eve')!.userId).toBeNull();
    expect(t.outgoing.items.map((o) => [o.project.title, o.invitee.name]).toSorted()).toEqual([
      ['P1 private', 'b-pending'],
      ['P2 public', 'b-pending'],
    ]);
    expect(t.member.items).toEqual([]);
    expect(t.incoming.items).toEqual([]);
  });

  it('an accepted member sees the projects they joined (accepted teammates only), never a draft or a pending one', async () => {
    const http = await start();
    const { a, b, c } = await scene();
    const t = (await http.get('/v1/me/teams').set(a.auth).expect(200)).body as Teams;
    expect(names(t.member.items)).toEqual(['P1 private']);
    const p1 = t.member.items[0]!;
    expect(p1.owner.name).toBe('owner');
    expect(p1.team.map((m) => m.name).toSorted()).toEqual(['External Eve', 'a-accepted']);
    expect(p1.team.every((m) => m.status === 'accepted')).toBe(true);
    expect(t.owned.items).toEqual([]);
    expect(t.outgoing.items).toEqual([]);
    // pending and rejected people have no `member` entry
    for (const person of [b, c]) {
      const other = (await http.get('/v1/me/teams').set(person.auth).expect(200)).body as Teams;
      expect(other.member.items).toEqual([]);
    }
  });

  it('an invitee sees only the title and the inviter, not the project', async () => {
    const http = await start();
    const { b, p1, p2, owner } = await scene();
    const t = (await http.get('/v1/me/teams').set(b.auth).expect(200)).body as Teams;
    expect(
      t.incoming.items.map((i) => [i.project.id, i.project.title, i.invitedBy.name]).toSorted(),
    ).toEqual(
      [
        [p1.id, 'P1 private', 'owner'],
        [p2.id, 'P2 public', 'owner'],
      ].toSorted(),
    );
    expect(t.incoming.items[0]!.invitedBy.id).toBe(owner.user.id);
    const text = JSON.stringify(t);
    expect(text).not.toContain('secret plan');
    expect(Object.keys(t.incoming.items[0]!).toSorted()).toEqual([
      'id',
      'invitedAt',
      'invitedBy',
      'project',
      'role',
    ]);
    expect(Object.keys(t.incoming.items[0]!.project).toSorted()).toEqual(['id', 'title']);
    expect(t.owned.items).toEqual([]);
    expect(t.outgoing.items).toEqual([]); // only the project's owner has outgoing
    expect(t.member.items).toEqual([]);
  });

  it('a second user sees nothing of anyone else’s teams (S4)', async () => {
    const http = await start();
    const { x } = await scene();
    const t = (await http.get('/v1/me/teams').set(x.auth).expect(200)).body as Teams;
    expect([t.owned, t.member, t.incoming, t.outgoing].map((s) => s.items.length)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(JSON.stringify(t)).not.toMatch(/P1|P2|P3|External|secret/);
  });

  it('keeps a private profile’s link and photo out of the owner’s and the inviter’s views', async () => {
    const http = await start();
    const owner = await who('priv-owner', { isPublic: false });
    const hidden = await who('hidden', { isPublic: false, avatarUrl: 'https://img.example/h.png' });
    const { project } = await createProject(db, owner.user, { title: 'Hidden things' });
    await db
      .insertInto('projectTeamMembers')
      .values({
        id: newId(),
        projectId: project.id,
        userId: hidden.user.id,
        name: 'Saved Hidden',
        status: 'pending',
      })
      .execute();
    const mine = (await http.get('/v1/me/teams').set(owner.auth).expect(200)).body as Teams;
    expect(mine.owned.items[0]!.members[0]).toMatchObject({
      name: 'Saved Hidden',
      userId: null,
      avatarUrl: null,
    });
    expect(mine.outgoing.items[0]!.invitee).toEqual({
      id: null,
      name: 'Saved Hidden',
      avatarUrl: null,
    });
    const theirs = (await http.get('/v1/me/teams').set(hidden.auth).expect(200)).body as Teams;
    expect(theirs.incoming.items[0]!.invitedBy).toEqual({ id: null, name: 'priv-owner' });
  });

  it('gives a member no account link or photo for an owner whose profile is private', async () => {
    const http = await start();
    const owner = await who('priv-owner', {
      isPublic: false,
      avatarUrl: 'https://img.example/o.png',
    });
    const member = await who('member');
    const { project } = await createProject(db, owner.user, { title: 'Owned privately' });
    await addMember(project.id, member.user.id, 'accepted');
    const t = (await http.get('/v1/me/teams').set(member.auth).expect(200)).body as Teams;
    expect(t.member.items[0]!.owner).toEqual({ id: null, name: 'priv-owner', avatarUrl: null });
    expect(JSON.stringify(t)).not.toContain(owner.user.id);
  });

  it('follows the flow: invite, accept, reject, re-invite, remove, leave', async () => {
    const http = await start();
    const owner = await who('owner');
    const bob = await who('bob');
    const { project } = await createProject(db, owner.user, { title: 'Flow' });
    const view = async (p: { auth: { Authorization: string } }) =>
      (await http.get('/v1/me/teams').set(p.auth).expect(200)).body as Teams;

    await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: bob.user.id })
      .expect(201);
    expect((await view(owner)).outgoing.items).toHaveLength(1);
    expect((await view(bob)).incoming.items).toHaveLength(1);

    await http.post(`/v1/projects/${project.id}/team/me/reject`).set(bob.auth).expect(200);
    let o = await view(owner);
    expect(o.outgoing.items).toEqual([]);
    expect(o.owned.items[0]!.members.map((m) => m.status)).toEqual(['rejected']);
    expect((await view(bob)).incoming.items).toEqual([]);

    await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: bob.user.id })
      .expect(201);
    expect((await view(owner)).owned.items[0]!.members.map((m) => m.status)).toEqual(['pending']);
    await http.post(`/v1/projects/${project.id}/team/me/accept`).set(bob.auth).expect(200);
    o = await view(owner);
    expect(o.owned.items[0]!.members.map((m) => m.status)).toEqual(['accepted']);
    expect((await view(bob)).member.items.map((p) => p.title)).toEqual(['Flow']);

    await http.delete(`/v1/projects/${project.id}/team/me`).set(bob.auth).expect(204);
    expect((await view(bob)).member.items).toEqual([]);
    expect((await view(owner)).owned.items).toEqual([]); // a project without a team is not listed
    // the owner was told, in the notifications
    const told = await http.get('/v1/me/notifications').set(owner.auth).expect(200);
    expect((told.body.items as { type: string }[]).map((n) => n.type)).toContain('team_left');
  });

  it('pages each list on its own cursor without repeats, and rejects another list’s cursor', async () => {
    const http = await start({ TEAMS_PAGE_SIZE: '2' });
    const owner = await who('owner');
    const bob = await who('bob');
    for (let i = 0; i < 5; i++) {
      const { project } = await createProject(db, owner.user, { title: `T${i}` });
      await addMember(project.id, i < 3 ? bob.user.id : null, i < 3 ? 'pending' : 'accepted');
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 5; guard++) {
      const t = (
        await http
          .get('/v1/me/teams')
          .query(cursor === null ? {} : { ownedCursor: cursor })
          .set(owner.auth)
          .expect(200)
      ).body as Teams;
      expect(t.owned.items.length).toBeLessThanOrEqual(2);
      seen.push(...t.owned.items.map((p) => p.id));
      cursor = t.owned.nextCursor;
      if (cursor === null) break;
    }
    expect(new Set(seen).size).toBe(5);

    const first = (await http.get('/v1/me/teams').set(owner.auth).expect(200)).body as Teams;
    const ownedCursor = first.owned.nextCursor!;
    const outgoingCursor = first.outgoing.nextCursor!;
    expect(first.outgoing.items).toHaveLength(2);
    // the other lists' first pages are unaffected by one list's cursor
    const only = (
      await http.get('/v1/me/teams').query({ outgoingCursor }).set(owner.auth).expect(200)
    ).body as Teams;
    expect(only.owned.items.map((p) => p.id)).toEqual(first.owned.items.map((p) => p.id));
    expect(only.outgoing.items).toHaveLength(1);
    for (const param of ['memberCursor', 'incomingCursor', 'outgoingCursor']) {
      const res = await http
        .get('/v1/me/teams')
        .query({ [param]: ownedCursor })
        .set(owner.auth)
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it.each([
    ['a cursor that is not one', { ownedCursor: 'nope' }],
    ['a limit over the maximum', { limit: '51' }],
    ['a limit of zero', { limit: '0' }],
    ['an unknown key', { sort: 'x' }],
  ])('answers 400 for %s', async (_n, query) => {
    const http = await start();
    const u = await who('u');
    expect((await http.get('/v1/me/teams').query(query).set(u.auth).expect(400)).body.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('runs a fixed number of statements however many projects and members there are (no N+1)', async () => {
    const http = await start();
    const dbs = app!.get(DbService);
    let queries = 0;
    (dbs as unknown as { db: Database }).db = dbs.db.withPlugin({
      transformQuery: (args) => {
        queries++;
        return args.node;
      },
      transformResult: (args) => Promise.resolve(args.result),
    });

    const populate = async (projects: number, perProject: number) => {
      const owner = await who(`o${projects}`);
      const joiner = await who(`j${projects}`);
      const invitee = await who(`i${projects}`);
      for (let p = 0; p < projects; p++) {
        const { project: mine } = await createProject(db, owner.user);
        for (let m = 0; m < perProject; m++)
          await addMember(mine.id, (await who(`m${projects}-${p}-${m}`)).user.id, 'pending');
        await addMember(mine.id, joiner.user.id, 'accepted');
        await addMember(mine.id, invitee.user.id, 'pending');
        await addMember(mine.id, null, 'accepted', 'Ext');
        const { project: theirs } = await createProject(db, joiner.user);
        await addMember(theirs.id, owner.user.id, 'accepted');
        await addMember(theirs.id, invitee.user.id, 'pending');
      }
      return { owner, joiner, invitee };
    };
    const countFor = async (p: { auth: { Authorization: string } }) => {
      queries = 0;
      await http.get('/v1/me/teams').set(p.auth).expect(200);
      return queries;
    };

    const small = await populate(1, 1);
    const big = await populate(8, 6);
    const counts = [
      await countFor(small.owner),
      await countFor(big.owner),
      await countFor(small.joiner),
      await countFor(big.joiner),
      await countFor(small.invitee),
      await countFor(big.invitee),
    ];
    // owner and joiner have all four lists; the data grew from 1 to 8 projects and ~10 to ~60 members
    expect(counts[1]).toBe(counts[0]);
    expect(counts[3]).toBe(counts[2]);
    expect(counts[5]).toBe(counts[4]);
    expect(Math.max(...counts)).toBeLessThanOrEqual(8);
  });

  it('needs a token and answers 429 once the budget is spent', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '2' });
    await http.get('/v1/me/teams').expect(401);
    const u = await who('u');
    await http.get('/v1/me/teams').set(u.auth).expect(200);
    await http.get('/v1/me/teams').set(u.auth).expect(200);
    expect((await http.get('/v1/me/teams').set(u.auth).expect(429)).body.code).toBe('RATE_LIMITED');
  });
});
