import { createConnection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testDatabaseUrl } from '../../../testing/database.js';
import { hashField } from '../../../core/github/snapshot.js';
import { githubConnectHarness, type Http, type Student } from '../../../testing/github-connect.js';
import { db } from '../../../testing/team.js';

/**
 * M7-T22: repository-change suggestions (`project.new`, `project.update`) and the one
 * notification per refresh batch, against MySQL 8.4 with GitHub as a fake over
 * real HTTP (docs/modules/m7/plan.md §6.6e). Races are forced with barriers on an InnoDB
 * lock or on a held GitHub answer, never sleeps. Every route has a second-user test.
 */

const h = githubConnectHarness();

const ENV = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...h.env(),
  RATE_LIMIT_IMPORT: '100',
  RATE_LIMIT_INTEGRATION: '100',
  SUGGESTIONS_MIN_INTERVAL_S: '0',
  ...over,
});

async function setup(over: NodeJS.ProcessEnv = {}) {
  const http = await h.start(ENV(over));
  const alice = await h.connectedStudent(http, '100', 'alice');
  const bob = await h.connectedStudent(http, '200', 'bob');
  return { http, alice, bob };
}

interface Item {
  id: string;
  kind: string;
  source: string;
  status: string;
  field: string | null;
  proposed: string | null;
  repository: { id: number; fullName: string } | null;
  project: { id: string | null; title: string } | null;
}

const githubIdOf = (s: Student) => Number(s.sub.split('|')[1]);
const loginOf = (s: Student) => (s.sub === 'github|100' ? 'alice' : 'bob');

/** An own public repository of `s` with no language or topic (no skill is suggested from it). */
function own(s: Student, id: number, over: Record<string, unknown> = {}) {
  return h.addRepo({
    id,
    ownerId: githubIdOf(s),
    ownerLogin: loginOf(s),
    name: `repo-${id}`,
    language: null,
    ...over,
  });
}

/** A push: the repository now shows a later `pushed_at` than any import. */
const pushed = (id: number) => {
  h.gh.repos.get(id)!.pushedAt = new Date(Date.now() + 3_600_000 + id * 1000).toISOString();
};

async function imported(http: Http, s: Student, id: number, over: Record<string, unknown> = {}) {
  own(s, id, over);
  const res = await http
    .post('/v1/me/github/import')
    .set(s.auth)
    .send({ repoIds: [id] });
  expect(res.status).toBe(200);
  expect(res.body.results[0].outcome).toBe('created');
  h.gh.requests.length = 0;
  return res.body.results[0].projectId as string;
}

const refresh = (http: Http, s: Student) => http.post('/v1/me/suggestions/refresh').set(s.auth);
const list = async (http: Http, s: Student, status = 'open'): Promise<Item[]> =>
  (
    (await http.get(`/v1/me/suggestions?status=${status}`).set(s.auth).expect(200)).body as {
      items: Item[];
    }
  ).items.filter((i) => i.kind.startsWith('project.'));
const accept = (http: Http, s: Student, id: string) =>
  http.post(`/v1/me/suggestions/${id}/accept`).set(s.auth);
const dismiss = (http: Http, s: Student, id: string) =>
  http.post(`/v1/me/suggestions/${id}/dismiss`).set(s.auth);
const sync = (http: Http, s: Student, projectId: string, query = '') =>
  http.post(`/v1/me/projects/${projectId}/github/sync${query}`).set(s.auth);
const edit = (http: Http, s: Student, projectId: string, body: Record<string, unknown>) =>
  http.patch(`/v1/projects/${projectId}`).set(s.auth).send(body).expect(200);

const notificationsOf = async (http: Http, s: Student) =>
  (
    (await http.get('/v1/me/notifications').set(s.auth).expect(200)).body as {
      items: {
        id: string;
        type: string;
        title: string;
        params: { count: number; kinds: string[] };
        read: boolean;
        link: string | null;
        invite: unknown;
      }[];
    }
  ).items.filter((n) => n.type === 'suggestions_available');

const readmeCalls = () => h.gh.requests.filter((r) => r.path.endsWith('/readme'));
const projectOf = (id: string) =>
  db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const projectsOf = (userId: string) =>
  db.selectFrom('projects').selectAll().where('userId', '=', userId).execute();

describe('project.update: a repository changed upstream', () => {
  it('a changed README gives one suggestion and one notification; refreshing again gives none', async () => {
    const { http, alice } = await setup();
    const projectId = await imported(http, alice, 1, { readme: '<p>v1</p>' });

    // Nothing changed upstream: nothing offered, and the README is not even read.
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
    expect(readmeCalls()).toEqual([]);
    expect(await notificationsOf(http, alice)).toEqual([]);

    h.gh.repos.get(1)!.readme = '<p>v2</p>';
    pushed(1);
    const res = await refresh(http, alice).expect(200);
    // GitHub’s profile did not change (304); the repositories are read all the same.
    expect(res.body).toMatchObject({ github: 'unchanged', created: 1, openCount: 1 });
    const rows = await list(http, alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'project.update',
      source: 'github',
      status: 'open',
      field: 'descriptionHtml',
      repository: { id: 1, fullName: 'alice/repo-1' },
      project: { id: projectId, title: 'repo-1' },
    });
    expect(rows[0]!.proposed).toContain('v2');
    // A suggestion, not a write.
    expect((await projectOf(projectId)).descriptionHtml).toContain('v1');

    const notes = await notificationsOf(http, alice);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      type: 'suggestions_available',
      title: 'Suggestions available',
      params: { count: 1, kinds: ['project.update'] },
      read: false,
      link: null,
      invite: null,
    });

    // The same state again: nothing new, and so nothing announced.
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
    expect(await notificationsOf(http, alice)).toHaveLength(1);
    expect(await list(http, alice)).toHaveLength(1);
  });

  it('a changed description is offered without reading the README (no push since the import)', async () => {
    const { http, alice } = await setup();
    await imported(http, alice, 2, { description: 'first words' });
    h.gh.repos.get(2)!.description = 'second words';

    const res = await refresh(http, alice).expect(200);
    expect(res.body.created).toBe(1);
    expect(readmeCalls()).toEqual([]);
    expect(await list(http, alice)).toMatchObject([
      { field: 'summary', proposed: 'second words', status: 'open' },
    ]);
  });

  it('a field the student edited is not offered and not touched; an unedited one still is', async () => {
    const { http, alice } = await setup();
    const projectId = await imported(http, alice, 3, {
      description: 'first words',
      readme: '<p>v1</p>',
    });
    await edit(http, alice, projectId, { summary: 'my own summary' });
    const repo = h.gh.repos.get(3)!;
    repo.description = 'upstream changed it too';
    repo.readme = '<p>v2</p>';
    pushed(3);

    const res = await refresh(http, alice).expect(200);
    expect(res.body.created).toBe(1);
    expect((await list(http, alice)).map((r) => r.field)).toEqual(['descriptionHtml']);
    expect((await projectOf(projectId)).summary).toBe('my own summary');
    // Again: the edited field stays out, the other one is not offered twice.
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
  });

  it('stars and forks stay silent: nothing is offered, announced or read; a re-sync refreshes them', async () => {
    const { http, alice } = await setup();
    const projectId = await imported(http, alice, 4);
    h.gh.repos.get(4)!.stars = 90;
    h.gh.repos.get(4)!.forks = 12;

    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
    expect(await list(http, alice, 'all')).toEqual([]);
    expect(await notificationsOf(http, alice)).toEqual([]);
    expect(readmeCalls()).toEqual([]);

    await sync(http, alice, projectId).expect(200);
    expect(await projectOf(projectId)).toMatchObject({ repoStars: 90, repoForks: 12 });
  });

  it('is withdrawn when GitHub is back to what the project holds, after a read', async () => {
    const { http, alice } = await setup();
    await imported(http, alice, 5, { readme: '<p>v1</p>' });
    h.gh.repos.get(5)!.readme = '<p>v2</p>';
    pushed(5);
    await refresh(http, alice).expect(200);
    expect(await list(http, alice)).toHaveLength(1);

    h.gh.repos.get(5)!.readme = '<p>v1</p>';
    pushed(5);
    await refresh(http, alice).expect(200);
    expect(await list(http, alice)).toEqual([]);
    expect(await list(http, alice, 'all')).toMatchObject([{ status: 'superseded' }]);
  });

  it('reads at most SUGGESTIONS_README_READS READMEs per refresh, the newest pushed first', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_README_READS: '1' });
    const older = await imported(http, alice, 6, { readme: '<p>a1</p>' });
    const newer = await imported(http, alice, 7, { readme: '<p>b1</p>' });
    h.gh.repos.get(6)!.readme = '<p>a2</p>';
    h.gh.repos.get(7)!.readme = '<p>b2</p>';
    pushed(6);
    pushed(7);

    const res = await refresh(http, alice).expect(200);
    expect(res.body.created).toBe(1);
    expect(readmeCalls()).toHaveLength(1);
    expect(await list(http, alice)).toMatchObject([{ project: { id: newer } }]);
    expect(older).not.toBe(newer);
  });
});

describe('one notification per refresh batch', () => {
  it('announces every repository suggestion of a refresh in a single notification', async () => {
    const { http, alice } = await setup();
    for (const id of [10, 11, 12]) {
      await imported(http, alice, id, { readme: `<p>${id} v1</p>` });
      h.gh.repos.get(id)!.readme = `<p>${id} v2</p>`;
      pushed(id);
    }
    own(alice, 13);
    own(alice, 14);

    const res = await refresh(http, alice).expect(200);
    expect(res.body.created).toBe(5);
    const notes = await notificationsOf(http, alice);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.params).toEqual({ count: 5, kinds: ['project.new', 'project.update'] });

    // Nothing changed: no second notification. A later change is a second batch.
    await refresh(http, alice).expect(200);
    expect(await notificationsOf(http, alice)).toHaveLength(1);
    h.gh.repos.get(10)!.description = 'a new description';
    await refresh(http, alice).expect(200);
    const after = await notificationsOf(http, alice);
    expect(after).toHaveLength(2);
    expect(after.map((n) => n.params)).toContainEqual({ count: 1, kinds: ['project.update'] });
  });

  it('counts only what is still open once the cap has superseded the oldest', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MAX_OPEN: '2' });
    for (const id of [20, 21, 22]) {
      await imported(http, alice, id, { readme: '<p>v1</p>' });
      h.gh.repos.get(id)!.readme = '<p>v2</p>';
      pushed(id);
    }
    const res = await refresh(http, alice).expect(200);
    expect(res.body).toMatchObject({ created: 3, openCount: 2 });
    expect((await notificationsOf(http, alice))[0]!.params.count).toBe(2);
  });

  it('writes none for the other kinds, and the notification is the caller’s alone', async () => {
    const { http, alice, bob } = await setup();
    h.gh.profiles.set(100, { bio: 'A bio from GitHub' });
    const res = await refresh(http, alice).expect(200);
    expect(res.body.created).toBe(1);
    expect(await notificationsOf(http, alice)).toEqual([]);

    await imported(http, alice, 30, { readme: '<p>v1</p>' });
    h.gh.repos.get(30)!.readme = '<p>v2</p>';
    pushed(30);
    await refresh(http, alice).expect(200);
    const [note] = await notificationsOf(http, alice);
    expect(note).toBeDefined();
    // Bob sees nothing of it, and cannot mark it read: 404, as for any other student's.
    expect(await notificationsOf(http, bob)).toEqual([]);
    await http.post(`/v1/me/notifications/${note!.id}/read`).set(bob.auth).expect(404);
    await http.post(`/v1/me/notifications/${note!.id}/read`).set(alice.auth).expect(204);
    expect((await notificationsOf(http, alice))[0]!.read).toBe(true);
  });
});

describe('accept a project.update', () => {
  async function offered(over: Record<string, unknown> = {}) {
    const ctx = await setup();
    const projectId = await imported(ctx.http, ctx.alice, 40, { readme: '<p>v1</p>', ...over });
    h.gh.repos.get(40)!.readme = '<p>v2</p>';
    pushed(40);
    await refresh(ctx.http, ctx.alice).expect(200);
    const [row] = await list(ctx.http, ctx.alice);
    return { ...ctx, projectId, row: row! };
  }

  it('writes the field that still equals the snapshot, moves the snapshot, once', async () => {
    const { http, alice, projectId, row } = await offered();

    const res = await accept(http, alice, row.id).expect(200);
    expect(res.body).toEqual({
      id: row.id,
      status: 'accepted',
      applied: { field: 'descriptionHtml', value: null },
      projectId,
    });
    const project = await projectOf(projectId);
    expect(project.descriptionHtml).toContain('v2');
    // The next re-sync sees nothing to do: the snapshot is what the accept wrote.
    const snapshot = (
      await db
        .selectFrom('projectGithubImports')
        .select('snapshot')
        .where('projectId', '=', projectId)
        .executeTakeFirstOrThrow()
    ).snapshot;
    expect(snapshot!.descriptionHtml).toBe(hashField('descriptionHtml', project.descriptionHtml));
    const resync = await sync(http, alice, projectId, '?dryRun=true').expect(200);
    expect(
      (resync.body.fields as { field: string; outcome: string }[]).map((f) => f.outcome),
    ).toEqual(Array(5).fill('unchanged'));

    // A retry reports the same and writes nothing more.
    const again = await accept(http, alice, row.id).expect(200);
    expect(again.body).toEqual(res.body);
    expect(await list(http, alice)).toEqual([]);
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
  });

  it('answers 409 SUGGESTION_STALE when the student edited the field since, and writes nothing', async () => {
    const { http, alice, projectId, row } = await offered();
    await edit(http, alice, projectId, { descriptionHtml: '<p>my words</p>' });

    const res = await accept(http, alice, row.id).expect(409);
    expect(res.body.code).toBe('SUGGESTION_STALE');
    expect((await projectOf(projectId)).descriptionHtml).toContain('my words');
    expect(await list(http, alice, 'all')).toMatchObject([{ id: row.id, status: 'superseded' }]);
    // Resolved: a second accept is not a second chance.
    expect((await accept(http, alice, row.id).expect(409)).body.code).toBe('SUGGESTION_RESOLVED');
  });

  it('answers 409 SUGGESTION_STALE when a re-sync already moved the snapshot', async () => {
    const { http, alice, projectId, row } = await offered();
    await sync(http, alice, projectId).expect(200);

    expect((await accept(http, alice, row.id).expect(409)).body.code).toBe('SUGGESTION_STALE');
    expect((await projectOf(projectId)).descriptionHtml).toContain('v2');
  });

  it('answers 409 SUGGESTION_STALE when the project was deleted', async () => {
    const { http, alice, projectId, row } = await offered();
    await db.deleteFrom('projects').where('id', '=', projectId).execute();
    expect((await accept(http, alice, row.id).expect(409)).body.code).toBe('SUGGESTION_STALE');
  });

  it('refuses a value the write rules no longer take: superseded, 409 SUGGESTION_INVALID', async () => {
    const { http, alice, projectId, row } = await offered();
    // A limit tightened since the offer, as the profile suggestions are tested.
    await db
      .updateTable('suggestions')
      .set({
        payload: JSON.stringify({
          field: 'summary',
          value: 'x'.repeat(70_000),
          baseHash: hashField('summary', (await projectOf(projectId)).summary),
          repoId: 40,
          title: 't',
        }) as never,
      })
      .where('id', '=', row.id)
      .execute();
    expect((await accept(http, alice, row.id).expect(409)).body.code).toBe('SUGGESTION_INVALID');
  });

  it('an accept racing the student’s edit leaves the edit (barrier on the project row)', async () => {
    const { http, alice, projectId, row } = await offered();
    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT id FROM projects WHERE id = ? FOR UPDATE', [projectId]);
      const accepting = accept(http, alice, row.id).then((r) => r);
      await waitForLockWaiters(1);
      await holder.query('UPDATE projects SET description_html = ? WHERE id = ?', [
        '<p>typed meanwhile</p>',
        projectId,
      ]);
      await holder.query('COMMIT');

      const res = await accepting;
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SUGGESTION_STALE');
      expect((await projectOf(projectId)).descriptionHtml).toBe('<p>typed meanwhile</p>');
    } finally {
      await holder.end();
    }
  });

  it('is the caller’s own only (second user): another’s id is 404 and nothing moves', async () => {
    const { http, alice, bob, projectId, row } = await offered();
    await accept(http, bob, row.id).expect(404);
    await dismiss(http, bob, row.id).expect(404);
    expect((await projectOf(projectId)).descriptionHtml).toContain('v1');
    expect(await list(http, bob)).toEqual([]);
    expect(await list(http, alice)).toMatchObject([{ id: row.id, status: 'open' }]);
  });

  it('a dismissed update is remembered; a newer upstream value is a new suggestion', async () => {
    const { http, alice, row } = await offered();
    await dismiss(http, alice, row.id).expect(200);
    await refresh(http, alice).expect(200);
    expect(await list(http, alice)).toEqual([]);

    h.gh.repos.get(40)!.readme = '<p>v3</p>';
    pushed(40);
    await refresh(http, alice).expect(200);
    expect((await list(http, alice))[0]!.proposed).toContain('v3');
  });
});

describe('refresh around the reads', () => {
  it('inside the floor an open update is kept; once the student edits the field it is withdrawn', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    const projectId = await imported(http, alice, 50, { readme: '<p>v1</p>' });
    h.gh.repos.get(50)!.readme = '<p>v2</p>';
    pushed(50);
    await refresh(http, alice).expect(200);
    h.gh.requests.length = 0;

    const kept = await refresh(http, alice).expect(200);
    expect(kept.body.github).toBe('throttled');
    expect(h.gh.requests).toEqual([]);
    expect(await list(http, alice)).toHaveLength(1);

    await edit(http, alice, projectId, { descriptionHtml: '<p>mine</p>' });
    expect((await refresh(http, alice).expect(200)).body.github).toBe('throttled');
    expect(await list(http, alice)).toEqual([]);
  });

  it('a re-sync committed while GitHub was being asked is not offered again (barrier on the user lock)', async () => {
    const { http, alice } = await setup();
    const projectId = await imported(http, alice, 51, { readme: '<p>v1</p>' });
    h.gh.repos.get(51)!.readme = '<p>v2</p>';
    pushed(51);

    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [alice.id]);
      // GitHub has been read (v2) when the refresh reaches the lock...
      const refreshing = refresh(http, alice).then((r) => r);
      await waitForLockWaiters(1);
      // ...and a re-sync applies v2 and commits before it gets the lock.
      await sync(http, alice, projectId).expect(200);
      await holder.query('COMMIT');

      const res = await refreshing;
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(0);
      expect(await list(http, alice, 'all')).toEqual([]);
      expect(await notificationsOf(http, alice)).toEqual([]);
      expect((await projectOf(projectId)).descriptionHtml).toContain('v2');
    } finally {
      await holder.end();
    }
  });

  it('a disconnect while GitHub is being asked leaves nothing: no suggestion, no notification (barrier)', async () => {
    const { http, alice } = await setup();
    await imported(http, alice, 52, { readme: '<p>v1</p>' });
    h.gh.repos.get(52)!.readme = '<p>v2</p>';
    pushed(52);
    own(alice, 53);

    const gate = h.gh.holdNextUser();
    const refreshing = refresh(http, alice).then((r) => r);
    await gate.arrived;
    await http.delete('/v1/me/integrations/github').set(alice.auth).expect(200);
    gate.release();

    const res = await refreshing;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ github: 'not_connected', created: 0, openCount: 0 });
    expect(await list(http, alice, 'all')).toEqual([]);
    expect(await notificationsOf(http, alice)).toEqual([]);
  });

  it('a disconnect deletes the open repository suggestions with the rest of GitHub’s', async () => {
    const { http, alice } = await setup();
    await imported(http, alice, 54, { readme: '<p>v1</p>' });
    h.gh.repos.get(54)!.readme = '<p>v2</p>';
    pushed(54);
    own(alice, 55);
    await refresh(http, alice).expect(200);
    expect(await list(http, alice)).toHaveLength(2);

    await http.delete('/v1/me/integrations/github').set(alice.auth).expect(200);
    expect(await list(http, alice, 'all')).toEqual([]);
  });

  it('costs, per refresh, the profile, the list, the languages, the links and the READMEs of pushed projects', async () => {
    const { http, alice } = await setup();
    await imported(http, alice, 56, { readme: '<p>v1</p>' });
    await imported(http, alice, 57, { readme: '<p>v1</p>' });
    h.gh.repos.get(57)!.readme = '<p>v2</p>';
    pushed(57);

    await refresh(http, alice).expect(200);
    const calls = h.gh.requests.map((r) => `${r.method} ${r.path}`);
    expect(calls.filter((c) => c.endsWith('/readme'))).toEqual(['GET /repositories/57/readme']);
    expect(calls).toEqual([
      'GET /user',
      'GET /user/repos',
      expect.stringMatching(/^GET \/repos\/alice\/repo-5[67]\/languages$/),
      expect.stringMatching(/^GET \/repos\/alice\/repo-5[67]\/languages$/),
      'GET /repositories/57/readme',
      'GET /user/social_accounts',
    ]);
    // No call per project beyond the one README: the description came with the list.
    expect(calls.filter((c) => c.startsWith('GET /repositories/'))).toEqual([
      'GET /repositories/57/readme',
    ]);
  });
});

describe('project.new: a repository not imported yet', () => {
  it('offers own public repositories only, newest push first, at most SUGGESTIONS_NEW_REPOS', async () => {
    const { http, alice, bob } = await setup({ SUGGESTIONS_NEW_REPOS: '2' });
    own(alice, 60);
    own(alice, 61);
    own(alice, 62);
    own(alice, 63);
    own(alice, 64, { fork: true });
    own(alice, 65, { archived: true });
    own(alice, 66, { private: true });
    own(bob, 67, { pushers: [100] });

    const res = await refresh(http, alice).expect(200);
    expect(res.body.created).toBe(2);
    const rows = await list(http, alice);
    expect(rows.map((r) => r.repository?.id).sort()).toEqual([62, 63]);
    expect(rows[0]).toMatchObject({ kind: 'project.new', project: { id: null } });

    // Dismissing one does not summon the next in its place.
    await dismiss(http, alice, rows[0]!.id).expect(200);
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
    expect(await list(http, alice)).toHaveLength(1);

    // Bob's repository is his own to be offered.
    expect((await refresh(http, bob).expect(200)).body.created).toBe(1);
    expect((await list(http, bob))[0]!.repository?.id).toBe(67);
  });

  it('none when SUGGESTIONS_NEW_REPOS is 0', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_NEW_REPOS: '0' });
    own(alice, 68);
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
  });

  it('an imported repository is not new', async () => {
    const { http, alice } = await setup();
    await imported(http, alice, 69);
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
  });

  it('an accept imports it as a draft through the import service, once', async () => {
    const { http, alice } = await setup();
    own(alice, 70, { description: 'About it', readme: '<p>Hello</p>' });
    await refresh(http, alice).expect(200);
    const [row] = await list(http, alice);

    const res = await accept(http, alice, row!.id).expect(200);
    const projects = await projectsOf(alice.id);
    expect(projects).toHaveLength(1);
    expect(res.body).toEqual({
      id: row!.id,
      status: 'accepted',
      applied: { field: 'project', value: null },
      projectId: projects[0]!.id,
    });
    expect(projects[0]).toMatchObject({
      isDraft: true,
      source: 'github',
      githubRepoId: 70,
      title: 'repo-70',
      summary: 'About it',
    });
    expect(projects[0]!.descriptionHtml).toContain('Hello');
    // Its snapshot is the import's, so the repository is tracked from now on.
    expect(
      await db
        .selectFrom('projectGithubImports')
        .select('projectId')
        .where('projectId', '=', projects[0]!.id)
        .execute(),
    ).toHaveLength(1);

    // A retry reports the same project; there is still one.
    expect((await accept(http, alice, row!.id).expect(200)).body).toEqual(res.body);
    expect(await projectsOf(alice.id)).toHaveLength(1);
    expect(await list(http, alice, 'all')).toMatchObject([
      { status: 'accepted', project: { id: projects[0]!.id } },
    ]);
  });

  it('two accepts at once make one draft and answer both (barrier on the user lock)', async () => {
    const { http, alice } = await setup();
    own(alice, 71);
    await refresh(http, alice).expect(200);
    const [row] = await list(http, alice);

    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [alice.id]);
      const a = accept(http, alice, row!.id).then((r) => r);
      const b = accept(http, alice, row!.id).then((r) => r);
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      const [ra, rb] = await Promise.all([a, b]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      expect(ra.body.projectId).toBe(rb.body.projectId);
    } finally {
      await holder.end();
    }
    expect(await projectsOf(alice.id)).toHaveLength(1);
  });

  it('is 409 SUGGESTION_STALE once the repository was imported another way, and withdrawn by a refresh', async () => {
    const { http, alice } = await setup();
    own(alice, 72);
    own(alice, 73);
    await refresh(http, alice).expect(200);
    const rows = await list(http, alice);
    const of = (repoId: number) => rows.find((r) => r.repository?.id === repoId)!;

    await http
      .post('/v1/me/github/import')
      .set(alice.auth)
      .send({ repoIds: [72, 73] })
      .expect(200);
    // 72 is answered by an accept, 73 by a refresh.
    expect((await accept(http, alice, of(72).id).expect(409)).body.code).toBe('SUGGESTION_STALE');
    await refresh(http, alice).expect(200);
    expect(await list(http, alice)).toEqual([]);
    expect((await list(http, alice, 'all')).map((r) => r.status)).toEqual([
      'superseded',
      'superseded',
    ]);
    expect(await projectsOf(alice.id)).toHaveLength(2);
  });

  it('is 409 SUGGESTION_STALE when the repository is gone from GitHub', async () => {
    const { http, alice } = await setup();
    own(alice, 74);
    await refresh(http, alice).expect(200);
    const [row] = await list(http, alice);
    h.gh.repos.delete(74);

    expect((await accept(http, alice, row!.id).expect(409)).body.code).toBe('SUGGESTION_STALE');
    expect(await projectsOf(alice.id)).toEqual([]);
  });

  it('is 409 LIMIT_REACHED at the project cap, and the suggestion stays open', async () => {
    const { http, alice } = await setup({ PROJECT_MAX_PER_USER: '1' });
    await imported(http, alice, 75);
    own(alice, 76);
    await refresh(http, alice).expect(200);
    const [row] = await list(http, alice);

    expect((await accept(http, alice, row!.id).expect(409)).body.code).toBe('LIMIT_REACHED');
    expect(await list(http, alice)).toMatchObject([{ id: row!.id, status: 'open' }]);
  });

  it('is withdrawn when the repository stops being the student’s own work', async () => {
    const { http, alice } = await setup();
    own(alice, 77);
    await refresh(http, alice).expect(200);
    h.gh.repos.get(77)!.archived = true;
    await refresh(http, alice).expect(200);
    expect(await list(http, alice)).toEqual([]);
  });

  it('is the caller’s own only (second user): another’s id is 404 and no draft appears', async () => {
    const { http, alice, bob } = await setup();
    own(alice, 78);
    await refresh(http, alice).expect(200);
    const [row] = await list(http, alice);

    await accept(http, bob, row!.id).expect(404);
    await dismiss(http, bob, row!.id).expect(404);
    expect(await projectsOf(bob.id)).toEqual([]);
    expect(await projectsOf(alice.id)).toEqual([]);
    expect(await list(http, alice)).toMatchObject([{ id: row!.id, status: 'open' }]);
    // GitHub was not asked to import anything for the refused accepts.
    expect(h.gh.requests.filter((r) => r.path === '/repositories/78/readme')).toEqual([]);
  });
});
