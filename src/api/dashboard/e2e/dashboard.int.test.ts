import type { NestExpressApplication } from '@nestjs/platform-express';
import { CompiledQuery } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../core/db/database.js';
import { DbService } from '../../../core/db/db.service.js';
import { newId } from '../../../core/db/ids.js';
import { toJsonColumn } from '../../../core/db/json.js';
import { translationParams } from '../../../core/validation/json-shapes.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig } from '../../../testing/database.js';
import { createProject } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { addMember, db, person, type Person } from '../../../testing/team.js';
import {
  projectStatsQuery,
  recentActivityCountQuery,
} from '../repositories/dashboard.repository.js';

/**
 * M6 PR (c): GET /v1/me/dashboard against MySQL 8.4 -- counts, recent projects,
 * the feed and the 30-day count equal what is stored; a second user gets their
 * own and nothing of anyone else's; the statement count is fixed; the indexes
 * serve each statement (docs/m6-plan.md §3.2, §7 X7).
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
const who = (label: string, over: Parameters<typeof person>[2] = {}) => person(tenant, label, over);

const day = (n: number) => new Date(Date.now() - n * 86_400_000);
const activity = (
  userId: string,
  key: string,
  params: Record<string, string | number>,
  at: Date,
  type: 'project' | 'profile' = 'project',
) =>
  db
    .insertInto('activities')
    .values({
      id: newId(),
      userId,
      type,
      translationKey: key,
      translationParams: toJsonColumn(translationParams, params),
      timestamp: at,
    })
    .execute();

interface Dash {
  stats: {
    projects: { total: number; published: number; private: number; draft: number };
    githubStars: number | null;
    recentActivities: number;
  };
  recentProjects: {
    id: string;
    title: string;
    role: string;
    isPublic: boolean;
    isDraft: boolean;
    technologies: string[];
  }[];
  activities: {
    id: string;
    translationKey: string;
    translationParams: Record<string, unknown> | null;
  }[];
}

async function scene() {
  const me = await who('Me');
  const other = await who('Other');
  const mk = (owner: Person, title: string, o: Parameters<typeof createProject>[2] = {}) =>
    createProject(db, owner.user, { title, ...o }).then((r) => r.project);
  const p = {
    a: await mk(me, 'A published', { updatedAt: day(5), repoStars: 7, technologies: ['Go', 'ML'] }),
    b: await mk(me, 'B private', { isPublic: false, updatedAt: day(3), repoStars: 5 }),
    c: await mk(me, 'C draft', { isDraft: true, updatedAt: day(1), repoStars: 100 }),
    d: await mk(me, 'D published', { updatedAt: day(10), technologies: ['React'] }),
    // someone else's
    theirs: await mk(other, 'Theirs published', { updatedAt: day(0) }),
    theirsPriv: await mk(other, 'Theirs private', { isPublic: false, updatedAt: day(0) }),
    teamPriv: await mk(other, 'Team private', { isPublic: false, updatedAt: day(2) }),
    teamDraft: await mk(other, 'Team draft', { isDraft: true, updatedAt: day(0) }),
    pending: await mk(other, 'Pending invite', { updatedAt: day(0) }),
  };
  await addMember(p.teamPriv.id, me.user.id, 'accepted');
  await addMember(p.teamDraft.id, me.user.id, 'accepted'); // a draft is never shown to a member
  await addMember(p.pending.id, me.user.id, 'pending');
  await activity(
    me.user.id,
    'projectCreated',
    { projectId: p.a.id, projectName: 'A published' },
    day(1),
  );
  await activity(me.user.id, 'newSkill', { skillName: 'Go' }, day(2), 'profile');
  await activity(
    me.user.id,
    'projectCreated',
    { projectId: p.d.id, projectName: 'D published' },
    day(29),
  );
  await activity(me.user.id, 'newSkill', { skillName: 'Old' }, day(31), 'profile'); // outside 30 days
  await activity(
    other.user.id,
    'projectCreated',
    { projectId: p.theirsPriv.id, projectName: 'Theirs private' },
    day(0),
  );
  return { me, other, p };
}

describe('GET /v1/me/dashboard', () => {
  it('shows the caller’s own counts, recent projects and feed, equal to what is stored', async () => {
    const s = await scene();
    const http = await start();
    const d = (await http.get('/v1/me/dashboard').set(s.me.auth).expect(200)).body as Dash;

    expect(d.stats.projects).toEqual({ total: 4, published: 2, private: 1, draft: 1 });
    expect(d.stats.githubStars).toBe(12); // 7 + 5; the draft's 100 does not count
    expect(d.stats.recentActivities).toBe(3); // the 31-day-old one does not

    // newest change first: Team private (2 d, accepted member), B (3 d), A (5 d); not the
    // draft (1 d is a *draft of mine*: it is mine, so it is listed)
    expect(d.recentProjects.map((r) => [r.title, r.role])).toEqual([
      ['C draft', 'owner'],
      ['Team private', 'member'],
      ['B private', 'owner'],
    ]);
    expect(d.recentProjects[0]).toMatchObject({ isDraft: true, isPublic: true });
    expect(d.activities.map((a) => a.translationKey)).toEqual([
      'projectCreated',
      'newSkill',
      'projectCreated',
      'newSkill',
    ]);
    expect(d.activities).toHaveLength(4);
  });

  it('has no linkedinConnections and only the documented keys', async () => {
    const s = await scene();
    const http = await start();
    const d = (await http.get('/v1/me/dashboard').set(s.me.auth).expect(200)).body as Dash;
    expect(Object.keys(d).toSorted()).toEqual(['activities', 'recentProjects', 'stats']);
    expect(Object.keys(d.stats).toSorted()).toEqual([
      'githubStars',
      'projects',
      'recentActivities',
    ]);
    expect(Object.keys(d.recentProjects[0]!).toSorted()).toEqual([
      'category',
      'id',
      'isDraft',
      'isPublic',
      'role',
      'status',
      'summary',
      'technologies',
      'title',
      'updatedAt',
    ]);
    const text = JSON.stringify(d);
    for (const k of ['linkedin', 'descriptionHtml', 'auth0', 'email', 'birthday', 'phone']) {
      expect(text).not.toContain(k);
    }
  });

  it('gives a second user their own dashboard and nothing of the first user’s (X7)', async () => {
    const s = await scene();
    const http = await start();
    const theirs = (await http.get('/v1/me/dashboard').set(s.other.auth).expect(200)).body as Dash;
    expect(theirs.stats.projects).toEqual({ total: 5, published: 2, private: 2, draft: 1 });
    // the other user's own list never carries the first user's private or draft work
    const text = JSON.stringify(theirs);
    for (const leak of ['A published', 'B private', 'C draft', 'D published']) {
      expect(text).not.toContain(leak);
    }
    expect(theirs.activities.map((a) => a.translationParams?.projectName)).toEqual([
      'Theirs private',
    ]);
    // and the first user never sees the other's activity or private projects they are not on
    const mine = (await http.get('/v1/me/dashboard').set(s.me.auth).expect(200)).body as Dash;
    expect(JSON.stringify(mine)).not.toContain('Theirs private');
    expect(JSON.stringify(mine)).not.toContain('Team draft');
    expect(JSON.stringify(mine)).not.toContain('Pending invite');
  });

  it('is null for stars when nothing is stored, zero counts for a new account, and honours the limits', async () => {
    const fresh = await who('Fresh');
    const http = await start({
      DASHBOARD_RECENT_PROJECTS: '2',
      DASHBOARD_FEED_SIZE: '1',
      DASHBOARD_ACTIVITY_DAYS: '3',
    });
    const empty = (await http.get('/v1/me/dashboard').set(fresh.auth).expect(200)).body as Dash;
    expect(empty).toMatchObject({
      stats: {
        projects: { total: 0, published: 0, private: 0, draft: 0 },
        githubStars: null,
        recentActivities: 0,
      },
      recentProjects: [],
      activities: [],
    });
    const s = await scene();
    const d = (await http.get('/v1/me/dashboard').set(s.me.auth).expect(200)).body as Dash;
    expect(d.recentProjects).toHaveLength(2);
    expect(d.activities).toHaveLength(1);
    expect(d.stats.recentActivities).toBe(2); // the 1- and 2-day-old ones; not 29 or 31
  });

  it('answers 0 stars, not null, when stars are stored as zero', async () => {
    const me = await who('Zero');
    await createProject(db, me.user, { title: 'Zero', repoStars: 0 });
    const http = await start();
    const d = (await http.get('/v1/me/dashboard').set(me.auth).expect(200)).body as Dash;
    expect(d.stats.githubStars).toBe(0);
  });

  it('needs a token, and is rate limited per caller', async () => {
    const me = await who('Rl');
    const http = await start({ RATE_LIMIT_DEFAULT: '2' });
    await http.get('/v1/me/dashboard').expect(401);
    await http.get('/v1/me/dashboard').set(me.auth).expect(200);
    await http.get('/v1/me/dashboard').set(me.auth).expect(200);
    expect((await http.get('/v1/me/dashboard').set(me.auth).expect(429)).body.code).toBe(
      'RATE_LIMITED',
    );
    const other = await who('Rl2');
    await http.get('/v1/me/dashboard').set(other.auth).expect(200);
  });

  it('runs the same number of statements for a new account as for one with 25 projects and 40 activities (no N+1)', async () => {
    const http = await start();
    const dbs = app!.get(DbService);
    let n = 0;
    (dbs as unknown as { db: Database }).db = dbs.db.withPlugin({
      transformQuery: (args) => {
        n++;
        return args.node;
      },
      transformResult: (args) => Promise.resolve(args.result),
    });
    const count = async (p: Person) => {
      n = 0;
      await http.get('/v1/me/dashboard').set(p.auth).expect(200);
      return n;
    };
    const small = await who('Small');
    await createProject(db, small.user, { title: 'one', technologies: ['Go'] });
    const big = await who('Big');
    for (let i = 0; i < 25; i++) {
      const proj = await createProject(db, big.user, {
        title: `P${i}`,
        technologies: ['Go', `T${i}`],
        repoStars: i,
      });
      const owner = await who(`Owner${i}`);
      const theirs = await createProject(db, owner.user, { title: `T${i}` });
      await addMember(theirs.project.id, big.user.id, 'accepted');
      void proj;
    }
    for (let i = 0; i < 40; i++)
      await activity(big.user.id, 'newSkill', { skillName: `S${i}` }, day(i % 20), 'profile');
    const a = await count(small);
    const b = await count(big);
    expect(b).toBe(a);
    // guard + stats + recent rows + technologies + activity count + feed
    expect(b).toBeLessThanOrEqual(7);
  });
});

describe('the dashboard statements use the indexes of 0006 and the owner key (plan §6)', () => {
  async function explain(q: { compile: () => { sql: string; parameters: readonly unknown[] } }) {
    const c = q.compile();
    const res = await db.executeQuery<Record<string, unknown>>(
      CompiledQuery.raw(`EXPLAIN FORMAT=TREE ${c.sql}`, [...c.parameters]),
    );
    return String(Object.values(res.rows[0]!)[0]);
  }

  it('reads the caller’s projects through their owner key and the activity count through (user_id, timestamp)', async () => {
    const s = await scene();
    const stats = await explain(projectStatsQuery(db, s.me.user.id));
    expect(stats).toMatch(
      /Index lookup on projects using (uq_projects_user_repo|idx_projects_user)/,
    );
    const count = await explain(recentActivityCountQuery(db, s.me.user.id, day(30)));
    expect(count).toMatch(/idx_activities_user_ts/);
    expect(count).toMatch(/Covering index/);
  });
});
