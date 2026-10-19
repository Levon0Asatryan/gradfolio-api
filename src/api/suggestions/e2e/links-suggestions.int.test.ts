import { describe, expect, it } from 'vitest';
import { githubConnectHarness, type Http, type Student } from '../../../testing/github-connect.js';
import { db } from '../../../testing/team.js';

/**
 * M7-T21: `profile.links.linkedin` and `profile.links.twitter` suggestions from
 * GitHub's social accounts, against MySQL 8.4 with GitHub as a fake over real HTTP.
 * Offered to an empty field only; an accept never replaces a filled one.
 */

const h = githubConnectHarness();

interface Item {
  id: string;
  kind: string;
  status: string;
  field: string | null;
  current: string | null;
  proposed: string | null;
  mode: string | null;
}

const ENV = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...h.env(),
  RATE_LIMIT_INTEGRATION: '100',
  SUGGESTIONS_MIN_INTERVAL_S: '0',
  // These tests are about profile, link and skill suggestions: no repository is offered as new.
  SUGGESTIONS_NEW_REPOS: '0',
  ...over,
});

async function setup(over: NodeJS.ProcessEnv = {}) {
  const http = await h.start(ENV(over));
  const alice = await h.connectedStudent(http, '100', 'alice');
  const bob = await h.connectedStudent(http, '200', 'bob');
  return { http, alice, bob };
}

const LINKEDIN = 'https://www.linkedin.com/in/alice-example';
const X = 'https://x.com/alice_example';

const refresh = (http: Http, s: Student) => http.post('/v1/me/suggestions/refresh').set(s.auth);
const linkRows = async (http: Http, s: Student, status = 'open'): Promise<Item[]> =>
  (
    (await http.get(`/v1/me/suggestions?status=${status}`).set(s.auth).expect(200)).body as {
      items: Item[];
    }
  ).items.filter((i) => i.kind.startsWith('profile.links.') && i.kind !== 'profile.links.github');
const linksOf = async (s: Student) =>
  db
    .selectFrom('users')
    .select(['linkedin', 'twitter'])
    .where('id', '=', s.id)
    .executeTakeFirstOrThrow();
const setLinks = (s: Student, over: { linkedin?: string; twitter?: string }) =>
  db.updateTable('users').set(over).where('id', '=', s.id).execute();
const socialCalls = () => h.gh.requests.filter((r) => r.path === '/user/social_accounts');

describe('which links are offered', () => {
  it('a LinkedIn account and an empty field: one suggestion; a filled field: none', async () => {
    const { http, alice, bob } = await setup();
    h.gh.socialAccounts.set(100, [{ provider: 'linkedin', url: LINKEDIN }]);
    h.gh.socialAccounts.set(200, [{ provider: 'linkedin', url: LINKEDIN }]);
    await setLinks(bob, { linkedin: 'https://www.linkedin.com/in/bob-typed' });

    const res = await refresh(http, alice).expect(200);
    expect(res.body).toMatchObject({ github: 'refreshed', created: 1 });
    const rows = await linkRows(http, alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'profile.links.linkedin',
      field: 'links.linkedin',
      current: null,
      proposed: LINKEDIN,
      mode: 'fill',
    });
    // Nothing is written until an accept.
    expect(await linksOf(alice)).toEqual({ linkedin: null, twitter: null });

    expect((await refresh(http, bob).expect(200)).body.created).toBe(0);
    expect(await linkRows(http, bob)).toEqual([]);
    expect((await linksOf(bob)).linkedin).toBe('https://www.linkedin.com/in/bob-typed');
  });

  it('offers X (GitHub’s "twitter") too, and nothing for a provider the profile has no field for', async () => {
    const { http, alice } = await setup();
    h.gh.socialAccounts.set(100, [
      { provider: 'twitter', url: X },
      { provider: 'youtube', url: 'https://youtube.com/@alice' },
      { provider: 'mastodon', url: 'https://mastodon.social/@alice' },
      { provider: 'generic', url: 'https://alice.example.com' },
    ]);
    await refresh(http, alice).expect(200);
    const rows = await linkRows(http, alice);
    expect(rows.map((r) => [r.kind, r.proposed])).toEqual([['profile.links.twitter', X]]);
  });

  it('drops an unsafe URL and keeps a safe one next to it', async () => {
    const { http, alice } = await setup();
    h.gh.socialAccounts.set(100, [
      { provider: 'linkedin', url: 'javascript:alert(1)' },
      { provider: 'twitter', url: X },
    ]);
    await refresh(http, alice).expect(200);
    expect((await linkRows(http, alice)).map((r) => r.kind)).toEqual(['profile.links.twitter']);
    expect(await linksOf(alice)).toEqual({ linkedin: null, twitter: null });
  });

  it('a student without GitHub gets none, and GitHub is not asked', async () => {
    const { http } = await setup();
    const loner = await h.student('auth0|no-github-links');
    h.gh.requests.length = 0;
    expect((await refresh(http, loner).expect(200)).body.github).toBe('not_connected');
    expect(h.gh.requests).toEqual([]);
  });
});

describe('what a refresh costs GitHub', () => {
  it('one profile read, one repository list and one social-accounts read; throttled: none', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    h.gh.socialAccounts.set(100, [{ provider: 'linkedin', url: LINKEDIN }]);
    h.gh.requests.length = 0;
    await refresh(http, alice).expect(200);
    expect(socialCalls()).toHaveLength(1);
    expect(h.gh.requests.map((r) => r.path)).toEqual([
      '/user',
      '/user/repos',
      '/user/social_accounts',
    ]);

    h.gh.requests.length = 0;
    const again = await refresh(http, alice).expect(200);
    expect(again.body.github).toBe('throttled');
    expect(h.gh.requests).toEqual([]);
    // Not asking is not evidence that the account went away.
    expect(await linkRows(http, alice)).toHaveLength(1);
  });

  it('a throttled refresh supersedes an open link whose field was filled meanwhile', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    h.gh.socialAccounts.set(100, [{ provider: 'linkedin', url: LINKEDIN }]);
    await refresh(http, alice).expect(200);
    await setLinks(alice, { linkedin: 'https://www.linkedin.com/in/typed-by-hand' });
    expect((await refresh(http, alice).expect(200)).body.github).toBe('throttled');
    expect(await linkRows(http, alice)).toEqual([]);
    expect((await linkRows(http, alice, 'all')).map((r) => r.status)).toEqual(['superseded']);
  });

  it('supersedes an open link when GitHub no longer lists the account', async () => {
    const { http, alice } = await setup();
    h.gh.socialAccounts.set(100, [{ provider: 'linkedin', url: LINKEDIN }]);
    await refresh(http, alice).expect(200);
    h.gh.socialAccounts.clear();
    await refresh(http, alice).expect(200);
    expect(await linkRows(http, alice)).toEqual([]);
    expect((await linkRows(http, alice, 'all')).map((r) => r.status)).toEqual(['superseded']);
  });
});

describe('accept and dismiss', () => {
  it('accept writes the field through the profile rules, once; it is not offered again', async () => {
    const { http, alice } = await setup();
    h.gh.socialAccounts.set(100, [
      { provider: 'linkedin', url: LINKEDIN },
      { provider: 'twitter', url: X },
    ]);
    await refresh(http, alice).expect(200);
    const row = (await linkRows(http, alice)).find((r) => r.field === 'links.linkedin')!;

    const res = await http.post(`/v1/me/suggestions/${row.id}/accept`).set(alice.auth).expect(200);
    expect(res.body).toEqual({
      id: row.id,
      status: 'accepted',
      applied: { field: 'links.linkedin', value: LINKEDIN },
      projectId: null,
    });
    expect(await linksOf(alice)).toEqual({ linkedin: LINKEDIN, twitter: null });
    await http.post(`/v1/me/suggestions/${row.id}/accept`).set(alice.auth).expect(200);
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
    // The other one is still waiting for its own answer.
    expect((await linkRows(http, alice)).map((r) => r.field)).toEqual(['links.twitter']);
  });

  it('409 SUGGESTION_STALE when the field was filled after the offer: it is not replaced', async () => {
    const { http, alice } = await setup();
    h.gh.socialAccounts.set(100, [{ provider: 'linkedin', url: LINKEDIN }]);
    await refresh(http, alice).expect(200);
    const [row] = await linkRows(http, alice);
    const typed = 'https://www.linkedin.com/in/typed-by-hand';
    await setLinks(alice, { linkedin: typed });

    const res = await http.post(`/v1/me/suggestions/${row!.id}/accept`).set(alice.auth).expect(409);
    expect(res.body.code).toBe('SUGGESTION_STALE');
    expect((await linksOf(alice)).linkedin).toBe(typed);
    expect((await linkRows(http, alice, 'all')).map((r) => r.status)).toEqual(['superseded']);
  });

  it('409 SUGGESTION_INVALID when the write rules refuse the stored value now', async () => {
    const { http, alice } = await setup();
    h.gh.socialAccounts.set(100, [{ provider: 'linkedin', url: LINKEDIN }]);
    await refresh(http, alice).expect(200);
    const [row] = await linkRows(http, alice);
    await db
      .updateTable('suggestions')
      .set({
        payload: JSON.stringify({
          field: 'links.linkedin',
          value: 'javascript:alert(1)',
          mode: 'fill',
        }) as never,
      })
      .where('id', '=', row!.id)
      .execute();

    const res = await http.post(`/v1/me/suggestions/${row!.id}/accept`).set(alice.auth).expect(409);
    expect(res.body.code).toBe('SUGGESTION_INVALID');
    expect(await linksOf(alice)).toEqual({ linkedin: null, twitter: null });
  });

  it('dismiss hides it, and a later refresh does not offer the same value again', async () => {
    const { http, alice } = await setup();
    h.gh.socialAccounts.set(100, [{ provider: 'linkedin', url: LINKEDIN }]);
    await refresh(http, alice).expect(200);
    const [row] = await linkRows(http, alice);
    await http.post(`/v1/me/suggestions/${row!.id}/dismiss`).set(alice.auth).expect(200);

    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
    expect(await linkRows(http, alice)).toEqual([]);
    expect(await linksOf(alice)).toEqual({ linkedin: null, twitter: null });

    // A new URL is a new suggestion.
    h.gh.socialAccounts.set(100, [{ provider: 'linkedin', url: `${LINKEDIN}-2` }]);
    expect((await refresh(http, alice).expect(200)).body.created).toBe(1);
  });

  it('is the caller’s own only (second user): another’s link suggestion is 404 and nothing moves', async () => {
    const { http, alice, bob } = await setup();
    h.gh.socialAccounts.set(100, [{ provider: 'linkedin', url: LINKEDIN }]);
    await refresh(http, alice).expect(200);
    const [row] = await linkRows(http, alice);

    for (const route of ['accept', 'dismiss']) {
      const res = await http
        .post(`/v1/me/suggestions/${row!.id}/${route}`)
        .set(bob.auth)
        .expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
    expect(await linksOf(bob)).toEqual({ linkedin: null, twitter: null });
    expect(await linksOf(alice)).toEqual({ linkedin: null, twitter: null });
    expect((await linkRows(http, alice)).map((r) => r.status)).toEqual(['open']);
  });
});
