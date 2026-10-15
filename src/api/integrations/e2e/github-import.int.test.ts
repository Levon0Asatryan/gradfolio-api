import { createConnection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testDatabaseUrl } from '../../../testing/database.js';
import { githubConnectHarness, type Http, type Student } from '../../../testing/github-connect.js';
import { db } from '../../../testing/team.js';

/**
 * M7 PR (b): GitHub repository list, import and re-sync against MySQL 8.4,
 * with Auth0 and GitHub as fakes over real HTTP (docs/m7-plan.md §3, §10).
 * Races are forced with barriers on the user lock or on a held GitHub answer,
 * never sleeps. Every route has a second-user test.
 */

const h = githubConnectHarness();
const SENTINEL = /gho_SENTINEL/;

const LIMITED = () => ({ ...h.env(), RATE_LIMIT_IMPORT: '100', RATE_LIMIT_INTEGRATION: '100' });

async function setup(
  over: NodeJS.ProcessEnv = {},
): Promise<{ http: Http; alice: Student; bob: Student }> {
  const http = await h.start({ ...LIMITED(), ...over });
  const alice = await h.connectedStudent(http, '100', 'alice');
  const bob = await h.connectedStudent(http, '200', 'bob');
  return { http, alice, bob };
}

interface Row {
  repoId: number;
  outcome: string;
  reason: string | null;
  projectId: string | null;
  notes: string[];
  imported: boolean;
}
const rowsOf = (res: { body: unknown }, key: 'items' | 'results'): Row[] =>
  (res.body as Record<string, Row[]>)[key] ?? [];

const projectRow = (userId: string, repoId: number) =>
  db
    .selectFrom('projects')
    .selectAll()
    .where('userId', '=', userId)
    .where('githubRepoId', '=', repoId)
    .executeTakeFirst();

const importIds = (http: Http, s: Student, repoIds: number[]) =>
  http.post('/v1/me/github/import').set(s.auth).send({ repoIds });

describe('GET /v1/me/github/repos', () => {
  it('lists the caller’s public repositories, newest push first, and marks the imported ones', async () => {
    const { http, alice, bob } = await setup();
    h.addRepo({ id: 1, ownerId: 100, name: 'old' });
    h.addRepo({ id: 2, ownerId: 100, name: 'new' });
    h.addRepo({ id: 3, ownerId: 100, name: 'secret', private: true });
    h.addRepo({ id: 4, ownerId: 999, name: 'not-mine' });
    h.addRepo({ id: 5, ownerId: 999, name: 'collab', pushers: [100] });
    h.addRepo({ id: 6, ownerId: 200, name: 'bobs' });
    await importIds(http, alice, [1]).expect(200);

    const res = await http.get('/v1/me/github/repos').set(alice.auth).expect(200);
    const items = res.body.items as {
      repoId: number;
      imported: boolean;
      projectId: string | null;
    }[];
    expect(items.map((i) => i.repoId)).toEqual([5, 2, 1]);
    const imported = items.find((i) => i.repoId === 1)!;
    expect(imported.imported).toBe(true);
    expect(imported.projectId).toBe((await projectRow(alice.id, 1))!.id);
    expect(items.find((i) => i.repoId === 2)).toMatchObject({ imported: false, projectId: null });
    expect(res.body.rateLimit.remaining).toBe(4999);
    expect(res.body.nextCursor).toBeNull();

    // Second user: Bob's list does not show Alice's import, nor her repositories.
    const bobs = await http.get('/v1/me/github/repos').set(bob.auth).expect(200);
    expect(rowsOf(bobs, 'items').map((i) => i.repoId)).toEqual([6]);
    expect(bobs.body.items[0]).toMatchObject({ imported: false, projectId: null });
  });

  it('pages with an opaque cursor, and refuses one this API did not issue', async () => {
    const { http, alice } = await setup();
    for (const id of [1, 2, 3]) h.addRepo({ id, ownerId: 100 });
    const first = await http.get('/v1/me/github/repos?limit=2').set(alice.auth).expect(200);
    expect(rowsOf(first, 'items').map((i) => i.repoId)).toEqual([3, 2]);
    expect(typeof first.body.nextCursor).toBe('string');
    const second = await http
      .get(`/v1/me/github/repos?limit=2&cursor=${first.body.nextCursor}`)
      .set(alice.auth)
      .expect(200);
    expect(rowsOf(second, 'items').map((i) => i.repoId)).toEqual([1]);
    expect(second.body.nextCursor).toBeNull();

    for (const bad of ['cursor=garbage', 'cursor=cDA', 'limit=0', 'limit=31', 'x=1']) {
      const res = await http.get(`/v1/me/github/repos?${bad}`).set(alice.auth);
      expect(res.status, bad).toBe(400);
    }
  });

  it('answers 409 when GitHub is not connected, and for a flag whose identity is gone', async () => {
    // No token cache: the identity's removal at Auth0 is seen by the next call.
    const { http, alice } = await setup({ GITHUB_TOKEN_CACHE_S: '0' });
    const loner = await h.student('auth0|no-github');
    const res = await http.get('/v1/me/github/repos').set(loner.auth).expect(409);
    expect(res.body.code).toBe('GITHUB_NOT_CONNECTED');
    expect(h.gh.requests.filter((r) => r.path.startsWith('/user/repos'))).toEqual([]);

    h.auth0.users.set(
      alice.sub,
      h.auth0.users.get(alice.sub)!.filter((i) => i.provider !== 'github'),
    );
    const gone = await http.get('/v1/me/github/repos').set(alice.auth).expect(409);
    expect(gone.body.code).toBe('GITHUB_NOT_LINKED');
  });

  it('maps GitHub’s limits and failures: 429 with Retry-After, 502', async () => {
    const { http, alice } = await setup();
    h.gh.repoMode = 'rate-limited';
    const limited = await http.get('/v1/me/github/repos').set(alice.auth).expect(429);
    expect(limited.body.code).toBe('GITHUB_RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    h.gh.repoMode = 'status-500';
    const down = await http.get('/v1/me/github/repos').set(alice.auth).expect(502);
    expect(down.body.code).toBe('GITHUB_UNAVAILABLE');
  });
});

describe('POST /v1/me/github/import', () => {
  it('creates a draft from what GitHub says, with the README as a sanitized description', async () => {
    const { http, alice } = await setup();
    h.addRepo({
      id: 10,
      ownerId: 100,
      ownerLogin: 'alice',
      name: 'thesis-tracker',
      description: 'Tracks a thesis',
      language: 'Python',
      stars: 42,
      forks: 7,
      readme:
        '<h1>Thesis</h1><p><img src="assets/banner.png" alt="Banner"> see <a href="docs/guide.md">guide</a></p>' +
        '<script>alert(1)</script><p><a href="javascript:alert(2)">x</a></p>',
    });
    const res = await importIds(http, alice, [10]).expect(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({ repoId: 10, outcome: 'created', reason: null, notes: [] }),
    ]);
    // The limit after the README call (the fake answers 4990 there, 4999 for the repository).
    expect(res.body.rateLimit.remaining).toBe(4990);

    const row = (await projectRow(alice.id, 10))!;
    expect(row).toMatchObject({
      title: 'thesis-tracker',
      summary: 'Tracks a thesis',
      source: 'github',
      isDraft: true,
      isPublic: true,
      repoStars: 42,
      repoForks: 7,
      repoLanguage: 'Python',
      repoUrl: 'https://github.com/alice/thesis-tracker',
    });
    expect(row.descriptionHtml).toContain('<h2>Thesis</h2>');
    expect(row.descriptionHtml).toContain('Banner');
    expect(row.descriptionHtml).toContain(
      'href="https://github.com/alice/thesis-tracker/blob/main/docs/guide.md"',
    );
    expect(row.descriptionHtml).not.toMatch(/<img|<script|javascript:|alert/i);
    const tech = await db
      .selectFrom('projectTechnologies')
      .select('name')
      .where('projectId', '=', row.id)
      .execute();
    expect(tech.map((t) => t.name)).toEqual(['Python']);
    const snap = await db
      .selectFrom('projectGithubImports')
      .select('snapshot')
      .where('projectId', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(Object.keys(snap.snapshot ?? {}).sort()).toEqual([
      'descriptionHtml',
      'repoUrl',
      'summary',
      'technologies',
      'title',
    ]);

    // A draft: the owner reads it as a GitHub project; nobody else does.
    const own = await http.get(`/v1/projects/${row.id}`).set(alice.auth).expect(200);
    expect(own.body).toMatchObject({ source: 'github', isDraft: true });
    // The list shape carries it too (the GitHub badge), and a manual project says manual.
    await http.post('/v1/projects').set(alice.auth).send({ title: 'By hand' }).expect(201);
    const mine = await http.get('/v1/me/projects').set(alice.auth).expect(200);
    const bySource = Object.fromEntries(
      (mine.body.items as { title: string; source: string }[]).map((p) => [p.title, p.source]),
    );
    expect(bySource).toEqual({ 'thesis-tracker': 'github', 'By hand': 'manual' });
    expect(own.body.repo).toMatchObject({ stars: 42, forks: 7, language: 'Python' });
  });

  it('is read again from GitHub: only integer ids are accepted, nothing else is a request', async () => {
    const { http, alice } = await setup();
    h.addRepo({ id: 11, ownerId: 100, stars: 5 });
    for (const body of [
      { repoIds: [11], stars: 99999 },
      { repoIds: [11], url: 'http://169.254.169.254/' },
      { repoIds: ['11'] },
      { repoIds: [-1] },
      { repoIds: [1.5] },
      { repoIds: [11, 11] },
      { repoIds: [] },
      { repoIds: Array.from({ length: 11 }, (_, i) => i + 1) },
      { repoIds: ['11/../../x'] },
      { repoIds: [1e21] },
      {},
    ]) {
      const res = await http.post('/v1/me/github/import').set(alice.auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(h.gh.requests.filter((r) => r.path.startsWith('/repositories'))).toEqual([]);

    await importIds(http, alice, [11]).expect(200);
    expect((await projectRow(alice.id, 11))!.repoStars).toBe(5);
    // Every path the API ever asked GitHub for, over all of the above.
    for (const r of h.gh.requests) {
      expect(r.path, r.path).toMatch(
        /^\/(user|user\/repos|repositories\/[0-9]+|repositories\/[0-9]+\/readme|applications\/[^/]+\/grant)$/,
      );
    }
  });

  it('imports only what the caller owns or may push to', async () => {
    const { http, alice } = await setup();
    h.addRepo({ id: 20, ownerId: 100 });
    h.addRepo({ id: 21, ownerId: 999, name: 'famous' });
    h.addRepo({ id: 22, ownerId: 999, name: 'team', pushers: [100] });
    h.addRepo({ id: 23, ownerId: 999, private: true });
    const res = await importIds(http, alice, [20, 21, 22, 23, 24]).expect(200);
    expect(rowsOf(res, 'results').map((r) => [r.repoId, r.outcome, r.reason])).toEqual([
      [20, 'created', null],
      [21, 'skipped', 'not_owner'],
      [22, 'created', null],
      [23, 'skipped', 'not_found'],
      [24, 'skipped', 'not_found'],
    ]);
    expect(await projectRow(alice.id, 21)).toBeUndefined();
  });

  it('imports a repository once: the second request finds the first project', async () => {
    const { http, alice, bob } = await setup();
    h.addRepo({ id: 30, ownerId: 100 });
    h.addRepo({ id: 31, ownerId: 200 });
    const first = await importIds(http, alice, [30]).expect(200);
    const second = await importIds(http, alice, [30]).expect(200);
    expect(second.body.results[0]).toMatchObject({
      outcome: 'exists',
      projectId: first.body.results[0].projectId,
    });
    expect(
      await db.selectFrom('projects').select('id').where('githubRepoId', '=', 30).execute(),
    ).toHaveLength(1);
    // Another account imports its own repository independently.
    await importIds(http, bob, [31]).expect(200);
    expect(await projectRow(bob.id, 30)).toBeUndefined();
  });

  it('two concurrent imports of one repository give one project (barrier on the user lock)', async () => {
    const { http, alice } = await setup();
    h.addRepo({ id: 40, ownerId: 100 });
    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [alice.id]);
      const a = importIds(http, alice, [40]).then((r) => r);
      const b = importIds(http, alice, [40]).then((r) => r);
      // Both have read GitHub and stand at the user lock.
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      const [ra, rb] = await Promise.all([a, b]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      const outcomes = [ra, rb].map((r) => r.body.results[0].outcome as string).sort();
      expect(outcomes).toEqual(['created', 'exists']);
    } finally {
      await holder.end();
    }
    expect(
      await db.selectFrom('projects').select('id').where('githubRepoId', '=', 40).execute(),
    ).toHaveLength(1);
  });

  it('a project deleted between the look and the user lock is not reported as existing (barrier)', async () => {
    const { http, alice } = await setup();
    h.addRepo({ id: 80, ownerId: 100 });
    const first = await importIds(http, alice, [80]).expect(200);
    const oldId = first.body.results[0].projectId as string;

    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [alice.id]);
      // The import has looked, found the project, and waits at the user lock ...
      const again = importIds(http, alice, [80]).then((r) => r);
      await waitForLockWaiters(1);
      // ... when the project is deleted (a project delete takes only the project's lock).
      await db.deleteFrom('projects').where('id', '=', oldId).execute();
      await holder.query('COMMIT');

      const res = await again;
      expect(res.status).toBe(200);
      const [result] = rowsOf(res, 'results');
      expect(result).toMatchObject({ repoId: 80, outcome: 'created' });
      expect(result!.projectId).not.toBe(oldId);
      expect((await projectRow(alice.id, 80))!.id).toBe(result!.projectId);
    } finally {
      await holder.end();
    }
  });

  it('an import with nothing read from GitHub reports no limit, not a stale one', async () => {
    const { http, alice } = await setup();
    h.addRepo({ id: 81, ownerId: 100 });
    await importIds(http, alice, [81]).expect(200);
    const again = await importIds(http, alice, [81]).expect(200);
    expect(again.body.results[0].outcome).toBe('exists');
    expect(again.body.rateLimit).toEqual({ remaining: null, resetsAt: null });
  });

  it('stops at the project cap with LIMIT_REACHED for the rest, creating those that fit', async () => {
    const { http, alice } = await setup({ PROJECT_MAX_PER_USER: '2' });
    for (const id of [50, 51, 52]) h.addRepo({ id, ownerId: 100 });
    const res = await importIds(http, alice, [50, 51, 52]).expect(200);
    expect(rowsOf(res, 'results').map((r) => r.outcome)).toEqual(['created', 'created', 'skipped']);
    expect(res.body.results[2].reason).toBe('LIMIT_REACHED');
  });

  it('a README over the byte cap is never read past it: the project is created without one', async () => {
    const { http, alice } = await setup({ GITHUB_README_MAX_BYTES: '2000' });
    h.addRepo({ id: 60, ownerId: 100, readme: `<p>${'x'.repeat(5000)}</p>` });
    h.addRepo({ id: 62, ownerId: 100, readme: null });
    const res = await importIds(http, alice, [60, 62]).expect(200);
    expect(rowsOf(res, 'results').map((r) => r.notes)).toEqual([['README_TOO_LARGE'], []]);
    // The capped answer's headers still count (the fake sends 4990 with a README).
    expect(res.body.rateLimit.remaining).toBe(4990);
    expect((await projectRow(alice.id, 60))!.descriptionHtml).toBeNull();
    expect((await projectRow(alice.id, 62))!.descriptionHtml).toBeNull();
  });

  it('a README that is small but too big as a description is left out, never truncated', async () => {
    const { http, alice } = await setup({ PROJECT_DESCRIPTION_MAX_BYTES: '1500' });
    h.addRepo({ id: 61, ownerId: 100, readme: `<p>${'y'.repeat(1700)}</p>` });
    h.addRepo({ id: 63, ownerId: 100, readme: `<p>${'z'.repeat(600)}</p>` });
    const res = await importIds(http, alice, [61, 63]).expect(200);
    expect(rowsOf(res, 'results').map((r) => r.notes)).toEqual([['README_TOO_LARGE'], []]);
    expect((await projectRow(alice.id, 61))!.descriptionHtml).toBeNull();
    expect((await projectRow(alice.id, 63))!.descriptionHtml).toContain('zzz');
  });

  it('the batch limit comes from configuration', async () => {
    const { http, alice } = await setup({ GITHUB_IMPORT_MAX_BATCH: '2' });
    const res = await importIds(http, alice, [1, 2, 3]).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(h.gh.requests.filter((r) => r.path.startsWith('/repositories'))).toEqual([]);
  });

  it('answers 409 without GitHub connected, and touches only the caller’s projects', async () => {
    const { http, alice, bob } = await setup();
    const loner = await h.student('auth0|import-loner');
    const res = await importIds(http, loner, [1]).expect(409);
    expect(res.body.code).toBe('GITHUB_NOT_CONNECTED');

    h.addRepo({ id: 70, ownerId: 100 });
    await importIds(http, alice, [70]).expect(200);
    // Bob has no 70: not found at GitHub for him (not his), and no row of Alice's moves.
    const bobs = await importIds(http, bob, [70]).expect(200);
    expect(bobs.body.results[0]).toMatchObject({ outcome: 'skipped', projectId: null });
    expect((await projectRow(alice.id, 70))!.userId).toBe(alice.id);
  });
});

describe('POST /v1/me/projects/{id}/github/sync', () => {
  async function imported(http: Http, s: Student, repoId: number, over = {}) {
    h.addRepo({ id: repoId, ownerId: Number(s.sub.split('|')[1]), ...over });
    const res = await importIds(http, s, [repoId]).expect(200);
    return res.body.results[0].projectId as string;
  }
  const sync = (http: Http, s: Student, id: string, query = '') =>
    http.post(`/v1/me/projects/${id}/github/sync${query}`).set(s.auth);
  const fieldsOf = (body: { fields: { field: string; outcome: string }[] }) =>
    Object.fromEntries(body.fields.map((f) => [f.field, f.outcome]));

  it('changes nothing when nothing changed', async () => {
    const { http, alice } = await setup();
    const id = await imported(http, alice, 100);
    const res = await sync(http, alice, id).expect(200);
    expect(Object.values(fieldsOf(res.body))).toEqual(Array(5).fill('unchanged'));
    expect(res.body.systemUpdated).toEqual([]);
  });

  it('updates what the student did not edit, keeps what they did, reports a conflict (the table of §3.5)', async () => {
    const { http, alice } = await setup();
    const id = await imported(http, alice, 101, {
      description: 'old summary',
      readme: '<p>old readme</p>',
    });
    // The student edits the title and the summary.
    await http
      .patch(`/v1/projects/${id}`)
      .set(alice.auth)
      .send({ title: 'My own title', summary: 'My own summary' })
      .expect(200);
    // GitHub: the summary changes (conflict with the edit), the README changes
    // (unedited: updated), the name stays (edited, upstream same: kept), stars move.
    const repo = h.gh.repos.get(101)!;
    repo.description = 'new upstream summary';
    repo.readme = '<p>new readme</p>';
    repo.stars = 77;

    const res = await sync(http, alice, id).expect(200);
    expect(fieldsOf(res.body)).toEqual({
      title: 'kept',
      summary: 'conflict',
      descriptionHtml: 'updated',
      repoUrl: 'unchanged',
      technologies: 'unchanged',
    });
    const summary = (res.body as { fields: { field: string; githubValue?: string }[] }).fields.find(
      (f) => f.field === 'summary',
    );
    expect(summary?.githubValue).toBe('new upstream summary');
    expect(res.body.systemUpdated).toEqual([{ field: 'stars', value: 77 }]);

    const row = (await projectRow(alice.id, 101))!;
    expect(row.title).toBe('My own title');
    expect(row.summary).toBe('My own summary');
    expect(row.descriptionHtml).toContain('new readme');
    expect(row.repoStars).toBe(77);

    // The conflict is reported again until the student resolves it.
    const again = await sync(http, alice, id).expect(200);
    expect(fieldsOf(again.body).summary).toBe('conflict');
    expect(fieldsOf(again.body).descriptionHtml).toBe('unchanged');
  });

  it('dryRun reports the same and writes nothing', async () => {
    const { http, alice } = await setup();
    const id = await imported(http, alice, 102, { readme: '<p>v1</p>' });
    h.gh.repos.get(102)!.readme = '<p>v2</p>';
    h.gh.repos.get(102)!.stars = 9;
    const res = await sync(http, alice, id, '?dryRun=true').expect(200);
    expect(res.body.dryRun).toBe(true);
    expect(fieldsOf(res.body).descriptionHtml).toBe('updated');
    const row = (await projectRow(alice.id, 102))!;
    expect(row.descriptionHtml).toContain('v1');
    expect(row.repoStars).toBe(3);
    // The real sync afterwards still sees the change.
    expect(fieldsOf((await sync(http, alice, id).expect(200)).body).descriptionHtml).toBe(
      'updated',
    );
  });

  it('an edit committed while GitHub is being asked is not overwritten (barrier)', async () => {
    const { http, alice } = await setup();
    const id = await imported(http, alice, 103, { description: 'v1' });
    h.gh.repos.get(103)!.description = 'v2';
    const gate = h.gh.holdNextRepo();
    const syncing = sync(http, alice, id).then((r) => r);
    await gate.arrived;
    // The student edits the summary now; the sync has GitHub's answer in flight.
    await http.patch(`/v1/projects/${id}`).set(alice.auth).send({ summary: 'Mine' }).expect(200);
    gate.release();
    const res = await syncing;
    expect(res.status).toBe(200);
    expect(fieldsOf(res.body).summary).toBe('conflict');
    expect((await projectRow(alice.id, 103))!.summary).toBe('Mine');
  });

  it('is the caller’s project only (second user), a GitHub one, and still connected', async () => {
    const { http, alice, bob } = await setup();
    const id = await imported(http, alice, 104);
    // Another user's project is a 404, never a 403, and GitHub is not asked.
    h.gh.requests.length = 0;
    expect((await sync(http, bob, id).expect(404)).body.code).toBe('NOT_FOUND');
    expect(h.gh.requests.filter((r) => r.path.startsWith('/repositories'))).toEqual([]);

    const manual = await http
      .post('/v1/projects')
      .set(alice.auth)
      .send({ title: 'Manual' })
      .expect(201);
    const notGithub = await sync(http, alice, manual.body.id).expect(409);
    expect(notGithub.body.code).toBe('NOT_GITHUB_PROJECT');

    h.gh.repos.delete(104);
    const gone = await sync(http, alice, id).expect(409);
    expect(gone.body.code).toBe('GITHUB_REPO_UNAVAILABLE');

    await http.delete('/v1/me/integrations/github').set(alice.auth).expect(200);
    const off = await sync(http, alice, id).expect(409);
    expect(off.body.code).toBe('GITHUB_NOT_CONNECTED');
  });
});

describe('the dashboard and the logs', () => {
  it('githubStars counts imported stars once the projects are published', async () => {
    const { http, alice } = await setup();
    h.addRepo({ id: 300, ownerId: 100, stars: 10 });
    h.addRepo({ id: 301, ownerId: 100, stars: 5 });
    const res = await importIds(http, alice, [300, 301]).expect(200);
    const [a, b] = rowsOf(res, 'results').map((r) => r.projectId);

    const before = await http.get('/v1/me/dashboard').set(alice.auth).expect(200);
    expect(before.body.stats.githubStars).toBeNull();
    expect(before.body.stats.projects.draft).toBe(2);

    await http.patch(`/v1/projects/${a}`).set(alice.auth).send({ isDraft: false }).expect(200);
    const one = await http.get('/v1/me/dashboard').set(alice.auth).expect(200);
    expect(one.body.stats.githubStars).toBe(10);
    await http.patch(`/v1/projects/${b}`).set(alice.auth).send({ isDraft: false }).expect(200);
    const both = await http.get('/v1/me/dashboard').set(alice.auth).expect(200);
    expect(both.body.stats.githubStars).toBe(15);
  });

  it('no token reaches a body, a header or a log through list, import and re-sync', async () => {
    const { http, alice } = await setup();
    h.addRepo({ id: 400, ownerId: 100 });
    const bodies: string[] = [];
    const keep = (r: { body: unknown; headers: Record<string, unknown> }) =>
      bodies.push(JSON.stringify(r.body), JSON.stringify(r.headers));
    keep(await http.get('/v1/me/github/repos').set(alice.auth).expect(200));
    const imp = await importIds(http, alice, [400]).expect(200);
    keep(imp);
    keep(
      await http
        .post(`/v1/me/projects/${imp.body.results[0].projectId}/github/sync`)
        .set(alice.auth)
        .expect(200),
    );
    h.gh.repoMode = 'status-500';
    keep(await http.get('/v1/me/github/repos').set(alice.auth).expect(502));
    for (const text of [...bodies, h.logs.text()]) expect(text).not.toMatch(SENTINEL);
  });

  it('import is under the tighter budget; listing counts separately', async () => {
    const http = await h.start({
      ...h.env(),
      RATE_LIMIT_IMPORT: '2',
      RATE_LIMIT_INTEGRATION: '50',
    });
    const alice = await h.connectedStudent(http, '100', 'alice');
    h.addRepo({ id: 500, ownerId: 100 });
    await importIds(http, alice, [500]).expect(200);
    await importIds(http, alice, [500]).expect(200);
    const limited = await importIds(http, alice, [500]).expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await http.get('/v1/me/github/repos').set(alice.auth).expect(200);
  });
});
