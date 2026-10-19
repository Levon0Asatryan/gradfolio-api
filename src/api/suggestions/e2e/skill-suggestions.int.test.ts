import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { createProject } from '../../../testing/factories.js';
import { githubConnectHarness, type Http, type Student } from '../../../testing/github-connect.js';
import { db } from '../../../testing/team.js';

/**
 * M7-T20: `skill.add` suggestions against MySQL 8.4 with GitHub as a fake over real
 * HTTP. A skill is offered when the student's own public repositories and projects
 * show it at least twice and the profile lacks it; an accept adds it, a dismiss is
 * remembered.
 */

const h = githubConnectHarness();
// The registry fixes the first spelling of a name for good: each test starts without one.
beforeEach(async () => {
  await db.deleteFrom('terms').execute();
});

interface Item {
  id: string;
  kind: string;
  status: string;
  skill: string | null;
  evidence: { total: number; repositories: number; projects: number } | null;
}

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

/** `n` own public repositories of GitHub user `ownerId`, each in `language`. */
let nextRepo = 1;
function repos(ownerId: number, login: string, n: number, over: Record<string, unknown> = {}) {
  for (let i = 0; i < n; i++) {
    h.addRepo({ id: nextRepo++, ownerId, ownerLogin: login, language: 'TypeScript', ...over });
  }
}

const refresh = (http: Http, s: Student) => http.post('/v1/me/suggestions/refresh').set(s.auth);
const skillRows = async (http: Http, s: Student, status = 'open'): Promise<Item[]> =>
  (
    (await http.get(`/v1/me/suggestions?status=${status}`).set(s.auth).expect(200)).body as {
      items: Item[];
    }
  ).items.filter((i) => i.kind === 'skill.add');
const names = (list: Item[]) => list.map((i) => i.skill).sort();
const skillsOf = async (_http: Http, s: Student): Promise<string[]> =>
  (
    await db
      .selectFrom('userSkills')
      .select('skillName')
      .where('userId', '=', s.id)
      .orderBy('sortOrder')
      .execute()
  ).map((r) => r.skillName);
const languageCalls = () =>
  h.gh.requests.filter((r) => r.method === 'GET' && r.path.endsWith('/languages'));
const setSkills = (userId: string, list: string[]) =>
  db
    .insertInto('terms')
    .values(list.map((name) => ({ name })))
    .onDuplicateKeyUpdate({ name: (eb) => eb.ref('name') })
    .execute()
    .then(() =>
      db
        .insertInto('userSkills')
        .values(list.map((skillName, sortOrder) => ({ id: newId(), userId, skillName, sortOrder })))
        .execute(),
    );

describe('which skills are offered', () => {
  it('three repositories in TypeScript and no such skill: one suggestion; with one repository, none', async () => {
    const { http, alice, bob } = await setup();
    repos(100, 'alice', 3);
    repos(200, 'bob', 1);

    const res = await refresh(http, alice).expect(200);
    expect(res.body).toMatchObject({ github: 'refreshed', created: 1 });
    const rows = await skillRows(http, alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      skill: 'TypeScript',
      status: 'open',
      evidence: { total: 3, repositories: 3, projects: 0 },
    });
    // Nothing is added until an accept.
    expect(await skillsOf(http, alice)).toEqual([]);

    await refresh(http, bob).expect(200);
    expect(await skillRows(http, bob)).toEqual([]);
  });

  it('offers topics and languages beyond the primary one, from the per-repository read', async () => {
    const { http, alice } = await setup();
    repos(100, 'alice', 2, {
      language: 'Python',
      topics: ['machine-learning'],
      languages: { Python: 900, Shell: 10 },
    });
    await refresh(http, alice).expect(200);
    expect(names(await skillRows(http, alice))).toEqual(['Python', 'Shell', 'machine-learning']);
  });

  it('does not offer what the profile has, whatever the case (the check is case-insensitive)', async () => {
    const { http, alice } = await setup();
    repos(100, 'alice', 3);
    await setSkills(alice.id, ['TYPESCRIPT']);
    const res = await refresh(http, alice).expect(200);
    expect(res.body.created).toBe(0);
    expect(await skillRows(http, alice)).toEqual([]);
  });

  it('counts only the student’s own repositories: not forks, not a collaborator’s', async () => {
    const { http, alice } = await setup();
    repos(100, 'alice', 1);
    repos(100, 'alice', 3, { fork: true });
    // A repository of bob's that alice may push to is not her own work.
    repos(200, 'bob', 3, { pushers: [100] });
    await refresh(http, alice).expect(200);
    expect(await skillRows(http, alice)).toEqual([]);
  });

  it('adds the skills of the student’s own projects to the evidence', async () => {
    const { http, alice } = await setup();
    await createProject(db, alice, { technologies: ['Docker'] });
    await createProject(db, alice, { technologies: ['docker'], isDraft: true });
    await createProject(db, alice, { technologies: ['Rust'] });
    await refresh(http, alice).expect(200);
    const rows = await skillRows(http, alice);
    expect(rows.map((r) => [r.skill, r.evidence])).toEqual([
      ['Docker', { total: 2, repositories: 0, projects: 2 }],
    ]);
  });

  it('counts a project imported from a repository, and that repository, once', async () => {
    const { http, alice } = await setup();
    repos(100, 'alice', 1, { language: 'Rust' });
    const repoId = nextRepo - 1;
    await createProject(db, alice, { technologies: ['Rust'], githubRepoId: repoId });
    await refresh(http, alice).expect(200);
    expect(await skillRows(http, alice)).toEqual([]);

    repos(100, 'alice', 1, { language: 'Rust' });
    await refresh(http, alice).expect(200);
    expect((await skillRows(http, alice))[0]).toMatchObject({
      skill: 'Rust',
      evidence: { total: 2, repositories: 2, projects: 1 },
    });
  });

  it('works without GitHub connected: projects alone, and a skill the projects stop showing is superseded', async () => {
    const { http } = await setup();
    const loner = await h.student('auth0|no-github-skills');
    const first = await createProject(db, loner, { technologies: ['Docker'] });
    await createProject(db, loner, { technologies: ['Docker'] });
    h.gh.requests.length = 0;
    const res = await refresh(http, loner).expect(200);
    expect(res.body).toMatchObject({ github: 'not_connected', created: 1 });
    expect(h.gh.requests).toEqual([]);
    expect(names(await skillRows(http, loner))).toEqual(['Docker']);

    await db.deleteFrom('projects').where('id', '=', first.project.id).execute();
    await refresh(http, loner).expect(200);
    expect(await skillRows(http, loner)).toEqual([]);
  });

  it('never offers another student’s project technologies', async () => {
    const { http, alice, bob } = await setup();
    await createProject(db, bob, { technologies: ['Docker'] });
    await createProject(db, bob, { technologies: ['Docker'] });
    await refresh(http, alice).expect(200);
    expect(await skillRows(http, alice)).toEqual([]);
  });
});

describe('what a refresh costs GitHub, and its cap', () => {
  it('asks /languages for the configured number of newest repositories only', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_LANGUAGE_REPOS: '2' });
    repos(100, 'alice', 6, { languages: { TypeScript: 5, Dockerfile: 1 } });
    h.gh.requests.length = 0;
    await refresh(http, alice).expect(200);

    const calls = languageCalls();
    expect(calls).toHaveLength(2);
    // The newest two (the fake sorts by pushed_at, which rises with the id).
    expect(calls.map((c) => c.path).sort()).toEqual(
      [nextRepo - 1, nextRepo - 2].map((id) => `/repos/alice/repo-${id}/languages`).sort(),
    );
    // One profile read, one list of repositories, two language reads, one social-accounts read.
    expect(h.gh.requests.filter((r) => r.method === 'GET')).toHaveLength(5);
    // Dockerfile is in two repositories' language lists only.
    expect(names(await skillRows(http, alice))).toEqual(['Dockerfile', 'TypeScript']);
  });

  it('with the cap at 0 asks for no language list, and a throttled refresh asks GitHub nothing', async () => {
    const { http, alice } = await setup({
      SUGGESTIONS_LANGUAGE_REPOS: '0',
      SUGGESTIONS_MIN_INTERVAL_S: '900',
    });
    repos(100, 'alice', 3);
    h.gh.requests.length = 0;
    await refresh(http, alice).expect(200);
    expect(languageCalls()).toHaveLength(0);
    expect(h.gh.requests.filter((r) => r.method === 'GET')).toHaveLength(3);

    h.gh.requests.length = 0;
    const again = await refresh(http, alice).expect(200);
    expect(again.body.github).toBe('throttled');
    expect(h.gh.requests).toEqual([]);
    // Not asking is not evidence that a repository went away.
    expect(names(await skillRows(http, alice))).toEqual(['TypeScript']);
  });

  it('supersedes an open suggestion when the repositories stop showing the skill', async () => {
    const { http, alice } = await setup();
    repos(100, 'alice', 2);
    await refresh(http, alice).expect(200);
    h.gh.repos.clear();
    await refresh(http, alice).expect(200);
    expect(await skillRows(http, alice)).toEqual([]);
    expect((await skillRows(http, alice, 'all')).map((r) => r.status)).toEqual(['superseded']);
  });

  it('fails the refresh when the repository read fails, and gives the claim back', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    repos(100, 'alice', 3);
    h.gh.repoMode = 'status-500';
    await refresh(http, alice).expect(502);
    h.gh.repoMode = 'ok';
    const res = await refresh(http, alice).expect(200);
    expect(res.body).toMatchObject({ github: 'refreshed', created: 1 });
  });
});

describe('accept and dismiss', () => {
  it('accept adds the skill to the profile, once, and the suggestion is accepted', async () => {
    const { http, alice } = await setup();
    repos(100, 'alice', 3);
    await setSkills(alice.id, ['Go']);
    await refresh(http, alice).expect(200);
    const [row] = await skillRows(http, alice);

    const res = await http.post(`/v1/me/suggestions/${row!.id}/accept`).set(alice.auth).expect(200);
    expect(res.body).toEqual({
      id: row!.id,
      status: 'accepted',
      applied: { field: 'skills', value: 'TypeScript' },
    });
    expect(await skillsOf(http, alice)).toEqual(['Go', 'TypeScript']);
    // Idempotent: the list does not change.
    await http.post(`/v1/me/suggestions/${row!.id}/accept`).set(alice.auth).expect(200);
    expect(await skillsOf(http, alice)).toEqual(['Go', 'TypeScript']);
    // And it is not offered again.
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
  });

  it('uses the spelling the registry already holds', async () => {
    const { http, alice, bob } = await setup();
    await setSkills(bob.id, ['TYPESCRIPT']);
    repos(100, 'alice', 2);
    await refresh(http, alice).expect(200);
    const [row] = await skillRows(http, alice);
    const res = await http.post(`/v1/me/suggestions/${row!.id}/accept`).set(alice.auth).expect(200);
    expect(res.body.applied).toEqual({ field: 'skills', value: 'TYPESCRIPT' });
    // A retry reports what was stored, not the spelling first suggested.
    const retry = await http
      .post(`/v1/me/suggestions/${row!.id}/accept`)
      .set(alice.auth)
      .expect(200);
    expect(retry.body.applied).toEqual({ field: 'skills', value: 'TYPESCRIPT' });
    expect(await skillsOf(http, alice)).toEqual(['TYPESCRIPT']);
  });

  it('dismiss hides it, and a later refresh does not offer it again', async () => {
    const { http, alice } = await setup();
    repos(100, 'alice', 3);
    await refresh(http, alice).expect(200);
    const [row] = await skillRows(http, alice);
    await http.post(`/v1/me/suggestions/${row!.id}/dismiss`).set(alice.auth).expect(200);
    expect(await skillRows(http, alice)).toEqual([]);

    repos(100, 'alice', 2);
    const again = await refresh(http, alice).expect(200);
    expect(again.body.created).toBe(0);
    expect(await skillRows(http, alice)).toEqual([]);
    expect(await skillsOf(http, alice)).toEqual([]);
  });

  it('409 SUGGESTION_STALE when the skill is already there (typed meanwhile), and it is superseded', async () => {
    const { http, alice } = await setup();
    repos(100, 'alice', 3);
    await refresh(http, alice).expect(200);
    const [row] = await skillRows(http, alice);
    await setSkills(alice.id, ['typescript']);

    const res = await http.post(`/v1/me/suggestions/${row!.id}/accept`).set(alice.auth).expect(409);
    expect(res.body.code).toBe('SUGGESTION_STALE');
    expect(await skillsOf(http, alice)).toEqual(['typescript']);
    expect((await skillRows(http, alice, 'all')).map((r) => r.status)).toEqual(['superseded']);
  });

  it('a profile at PROFILE_MAX_SKILLS refuses the accept and keeps the suggestion open', async () => {
    const { http, alice } = await setup({ PROFILE_MAX_SKILLS: '2' });
    repos(100, 'alice', 3);
    await refresh(http, alice).expect(200);
    const [row] = await skillRows(http, alice);
    await setSkills(alice.id, ['Go', 'Rust']);

    const res = await http.post(`/v1/me/suggestions/${row!.id}/accept`).set(alice.auth).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(await skillsOf(http, alice)).toEqual(['Go', 'Rust']);
    expect(names(await skillRows(http, alice))).toEqual(['TypeScript']);
  });

  it('is the caller’s own only (second user): another’s skill suggestion is 404 and nothing moves', async () => {
    const { http, alice, bob } = await setup();
    repos(100, 'alice', 3);
    await refresh(http, alice).expect(200);
    const [row] = await skillRows(http, alice);

    for (const route of ['accept', 'dismiss']) {
      const res = await http
        .post(`/v1/me/suggestions/${row!.id}/${route}`)
        .set(bob.auth)
        .expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
    expect(await skillsOf(http, bob)).toEqual([]);
    expect(await skillsOf(http, alice)).toEqual([]);
    expect(names(await skillRows(http, alice))).toEqual(['TypeScript']);
  });
});
