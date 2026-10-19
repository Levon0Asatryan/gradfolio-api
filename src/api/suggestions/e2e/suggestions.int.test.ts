import { createConnection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testDatabaseUrl } from '../../../testing/database.js';
import { createUser } from '../../../testing/factories.js';
import { githubConnectHarness, type Http, type Student } from '../../../testing/github-connect.js';
import { db } from '../../../testing/team.js';

/**
 * M7 PR (d1): suggestions against MySQL 8.4 with Auth0 and GitHub as fakes over
 * real HTTP (docs/modules/m7/plan.md §6). Races are forced with barriers (a held GitHub
 * answer, a held row lock), never sleeps. Every route has a second-user test.
 */

const h = githubConnectHarness();

interface Item {
  id: string;
  kind: string;
  source: string;
  status: string;
  field: string | null;
  current: string | null;
  proposed: string | null;
  mode: string | null;
  lastSyncedAt: string | null;
}
const items = (res: { body: unknown }) => (res.body as { items: Item[] }).items;
const byField = (list: Item[]): Record<string, Item> =>
  Object.fromEntries(list.map((i) => [i.field ?? '', i]));

const OPEN = () => ({
  ...h.env(),
  RATE_LIMIT_IMPORT: '100',
  RATE_LIMIT_INTEGRATION: '100',
  SUGGESTIONS_MIN_INTERVAL_S: '0',
});

async function setup(over: NodeJS.ProcessEnv = {}) {
  const http = await h.start({ ...OPEN(), ...over });
  const alice = await h.connectedStudent(http, '100', 'alice');
  const bob = await h.connectedStudent(http, '200', 'bob');
  h.gh.profiles.set(100, {
    name: 'Alice Liddell',
    bio: 'Builds things',
    location: 'Yerevan',
    company: '@NPUA',
    avatar_url: 'https://avatars.githubusercontent.com/u/100?v=4',
    blog: 'alice.example.am',
    html_url: 'https://github.com/alice',
  });
  h.gh.profiles.set(200, { bio: "Bob's bio" });
  return { http, alice, bob };
}

const refresh = (http: Http, s: Student) => http.post('/v1/me/suggestions/refresh').set(s.auth);
const open = async (http: Http, s: Student) =>
  items(await http.get('/v1/me/suggestions').set(s.auth).expect(200));
const profileRow = (id: string) =>
  db
    .selectFrom('users')
    .select(['name', 'headline', 'bio', 'location', 'avatarUrl', 'github', 'website'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
const userGets = () => h.gh.requests.filter((r) => r.method === 'GET' && r.path === '/user');

describe('refresh and list', () => {
  it('opens a suggestion per GitHub field that is empty or differs, with what it holds now', async () => {
    const { http, alice } = await setup();
    await db
      .updateTable('users')
      .set({ location: 'Gyumri', headline: 'CS undergraduate' })
      .where('id', '=', alice.id)
      .execute();

    const res = await refresh(http, alice).expect(200);
    expect(res.body).toMatchObject({ github: 'refreshed', created: 6 });
    const list = byField(await open(http, alice));
    // headline: GitHub's company is only offered to an empty headline.
    expect(Object.keys(list).sort()).toEqual(
      ['avatarUrl', 'bio', 'links.github', 'links.website', 'location', 'name'].sort(),
    );
    expect(list.bio).toMatchObject({ mode: 'fill', current: null, proposed: 'Builds things' });
    expect(list.location).toMatchObject({
      mode: 'replace',
      current: 'Gyumri',
      proposed: 'Yerevan',
    });
    expect(list['links.website']!.proposed).toBe('https://alice.example.am');
    expect(list.bio).toMatchObject({ kind: 'profile.bio', source: 'github', status: 'open' });
    // Nothing was written to the profile.
    expect(await profileRow(alice.id)).toMatchObject({ bio: null, location: 'Gyumri' });
  });

  it('is idempotent: a second refresh opens nothing, and the list is paged', async () => {
    const { http, alice } = await setup();
    await refresh(http, alice).expect(200);
    const again = await refresh(http, alice).expect(200);
    expect(again.body.created).toBe(0);
    expect(again.body.openCount).toBe(7);

    const page = await http.get('/v1/me/suggestions?limit=4').set(alice.auth).expect(200);
    expect(page.body.items).toHaveLength(4);
    expect(page.body.openCount).toBe(7);
    const rest = await http
      .get(`/v1/me/suggestions?limit=4&cursor=${page.body.nextCursor}`)
      .set(alice.auth)
      .expect(200);
    expect(rest.body.items).toHaveLength(3);
    expect(rest.body.nextCursor).toBeNull();
    for (const bad of ['cursor=garbage', 'limit=0', 'limit=101', 'status=nope', 'x=1']) {
      expect((await http.get(`/v1/me/suggestions?${bad}`).set(alice.auth)).status, bad).toBe(400);
    }
  });

  it('answers without GitHub connected: only the LinkedIn rules, no GitHub call', async () => {
    const { http } = await setup();
    const loner = await h.student('auth0|no-github-sugg');
    h.gh.requests.length = 0;
    const res = await refresh(http, loner).expect(200);
    expect(res.body).toMatchObject({ github: 'not_connected', created: 0, nextAllowedAt: null });
    expect(h.gh.requests).toEqual([]);
  });

  it('supersedes a suggestion GitHub no longer says, or the profile now equals', async () => {
    const { http, alice } = await setup();
    await refresh(http, alice).expect(200);
    h.gh.profiles.set(100, { ...h.gh.profiles.get(100)!, bio: 'A different bio' });
    // The student typed the location GitHub has.
    await db.updateTable('users').set({ location: 'Yerevan' }).where('id', '=', alice.id).execute();
    await refresh(http, alice).expect(200);

    const all = items(await http.get('/v1/me/suggestions?status=all').set(alice.auth).expect(200));
    const bio = all.filter((i) => i.field === 'bio');
    expect(bio.map((i) => [i.proposed, i.status]).sort()).toEqual([
      ['A different bio', 'open'],
      ['Builds things', 'superseded'],
    ]);
    expect(all.find((i) => i.field === 'location')!.status).toBe('superseded');
  });

  it('stops at SUGGESTIONS_MAX_OPEN, superseding the oldest', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MAX_OPEN: '2' });
    await refresh(http, alice).expect(200);
    expect((await open(http, alice)).length).toBe(2);
  });
});

describe('accept and dismiss', () => {
  it('accept writes the one field through the profile’s rules and nothing else, once', async () => {
    const { http, alice } = await setup();
    await refresh(http, alice).expect(200);
    const bio = byField(await open(http, alice)).bio!;
    const before = await profileRow(alice.id);

    const res = await http.post(`/v1/me/suggestions/${bio.id}/accept`).set(alice.auth).expect(200);
    expect(res.body).toEqual({
      id: bio.id,
      status: 'accepted',
      applied: { field: 'bio', value: 'Builds things' },
    });
    expect(await profileRow(alice.id)).toEqual({ ...before, bio: 'Builds things' });
    // Idempotent; the others are still open; a dismiss after an accept is a conflict.
    await http.post(`/v1/me/suggestions/${bio.id}/accept`).set(alice.auth).expect(200);
    const late = await http
      .post(`/v1/me/suggestions/${bio.id}/dismiss`)
      .set(alice.auth)
      .expect(409);
    expect(late.body.code).toBe('SUGGESTION_RESOLVED');
    expect((await open(http, alice)).map((i) => i.field)).not.toContain('bio');
  });

  it('accepts a link and an avatar (an external https URL) like a manual edit would', async () => {
    const { http, alice } = await setup();
    await refresh(http, alice).expect(200);
    const list = byField(await open(http, alice));
    await http
      .post(`/v1/me/suggestions/${list['links.github']!.id}/accept`)
      .set(alice.auth)
      .expect(200);
    await http.post(`/v1/me/suggestions/${list.avatarUrl!.id}/accept`).set(alice.auth).expect(200);
    expect(await profileRow(alice.id)).toMatchObject({
      github: 'https://github.com/alice',
      avatarUrl: 'https://avatars.githubusercontent.com/u/100?v=4',
    });
  });

  it('dismiss is remembered until GitHub’s value changes; a returning value stays dismissed', async () => {
    const { http, alice } = await setup();
    await refresh(http, alice).expect(200);
    const bio = byField(await open(http, alice)).bio!;
    await http.post(`/v1/me/suggestions/${bio.id}/dismiss`).set(alice.auth).expect(200);
    await http.post(`/v1/me/suggestions/${bio.id}/dismiss`).set(alice.auth).expect(200);

    // Same value: not offered again.
    await refresh(http, alice).expect(200);
    expect((await open(http, alice)).map((i) => i.field)).not.toContain('bio');

    // A new value is a new suggestion ...
    h.gh.profiles.set(100, { ...h.gh.profiles.get(100)!, bio: 'New bio' });
    const changed = await refresh(http, alice).expect(200);
    expect(changed.body.created).toBe(1);
    expect(byField(await open(http, alice)).bio!.proposed).toBe('New bio');

    // ... and going back to the dismissed one does not resurrect it.
    h.gh.profiles.set(100, { ...h.gh.profiles.get(100)!, bio: 'Builds things' });
    const back = await refresh(http, alice).expect(200);
    expect(back.body.created).toBe(0);
    expect((await open(http, alice)).map((i) => i.field)).not.toContain('bio');
  });

  it('refuses a value the write rules no longer take: superseded, 409 SUGGESTION_INVALID', async () => {
    const { http, alice } = await setup();
    await refresh(http, alice).expect(200);
    const site = byField(await open(http, alice))['links.website']!;
    // A stored payload that is no longer a valid URL (a rule was tightened since).
    await db
      .updateTable('suggestions')
      .set({
        payload: JSON.stringify({
          field: 'links.website',
          value: 'ftp://nope',
          mode: 'fill',
        }) as never,
      })
      .where('id', '=', site.id)
      .execute();
    const res = await http.post(`/v1/me/suggestions/${site.id}/accept`).set(alice.auth).expect(409);
    expect(res.body.code).toBe('SUGGESTION_INVALID');
    const row = await db
      .selectFrom('suggestions')
      .select('status')
      .where('id', '=', site.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('superseded');
    expect((await profileRow(alice.id)).website).toBeNull();
  });

  it('is the caller’s own only (second user): another’s id is 404, and nothing of theirs moves', async () => {
    const { http, alice, bob } = await setup();
    await refresh(http, alice).expect(200);
    await refresh(http, bob).expect(200);
    const mine = await open(http, alice);
    const theirs = await open(http, bob);
    expect(theirs.map((i) => i.proposed)).not.toContain('Builds things');
    expect(theirs.map((i) => i.id).some((id) => mine.some((m) => m.id === id))).toBe(false);

    for (const route of ['accept', 'dismiss']) {
      const res = await http
        .post(`/v1/me/suggestions/${mine[0]!.id}/${route}`)
        .set(bob.auth)
        .expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
    expect((await open(http, alice)).length).toBe(mine.length);
    expect((await profileRow(bob.id)).bio).toBeNull();
  });

  it('an accept and a dismiss at once leave one answer: the field changed iff it was accepted (barrier)', async () => {
    const { http, alice } = await setup();
    await refresh(http, alice).expect(200);
    const bio = byField(await open(http, alice)).bio!;

    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT id FROM suggestions WHERE id = ? FOR UPDATE', [bio.id]);
      const accept = http
        .post(`/v1/me/suggestions/${bio.id}/accept`)
        .set(alice.auth)
        .then((r) => r);
      const dismiss = http
        .post(`/v1/me/suggestions/${bio.id}/dismiss`)
        .set(alice.auth)
        .then((r) => r);
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      const [a, d] = await Promise.all([accept, dismiss]);
      const statuses = [a.status, d.status].sort();
      expect(statuses).toEqual([200, 409]);
      const stored = await db
        .selectFrom('suggestions')
        .select('status')
        .where('id', '=', bio.id)
        .executeTakeFirstOrThrow();
      const accepted = a.status === 200;
      expect(stored.status).toBe(accepted ? 'accepted' : 'dismissed');
      expect((await profileRow(alice.id)).bio).toBe(accepted ? 'Builds things' : null);
    } finally {
      await holder.end();
    }
  });
});

describe('reading GitHub: floor, ETag, failures, concurrency', () => {
  it('reads once per floor: a refresh inside it uses the stored profile and says throttled', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    const first = await refresh(http, alice).expect(200);
    expect(first.body.github).toBe('refreshed');
    expect(first.body.nextAllowedAt).toEqual(expect.any(String));
    const calls = userGets().length;
    const second = await refresh(http, alice).expect(200);
    expect(second.body.github).toBe('throttled');
    expect(userGets().length).toBe(calls);
    // Still computed from the stored profile: the student's own edit supersedes at once.
    await db
      .updateTable('users')
      .set({ bio: 'Builds things' })
      .where('id', '=', alice.id)
      .execute();
    await refresh(http, alice).expect(200);
    expect((await open(http, alice)).map((i) => i.field)).not.toContain('bio');
  });

  it('asks conditionally: the stored ETag goes out, a 304 recomputes from the stored profile', async () => {
    const { http, alice } = await setup();
    await refresh(http, alice).expect(200);
    const res = await refresh(http, alice).expect(200);
    expect(res.body.github).toBe('unchanged');
    const last = userGets().at(-1)!;
    expect(last.ifNoneMatch).toMatch(/^W\/"[0-9a-f]+"$/);
    // After an upstream change the ETag differs: a full read.
    h.gh.profiles.set(100, { ...h.gh.profiles.get(100)!, location: 'Vanadzor' });
    expect((await refresh(http, alice).expect(200)).body.github).toBe('refreshed');
  });

  it('two refreshes at once make one GitHub read (barrier on the held answer)', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    const calls = userGets().length;
    const gate = h.gh.holdNextUser();
    const first = refresh(http, alice).then((r) => r);
    await gate.arrived;
    const second = await refresh(http, alice).expect(200);
    expect(second.body.github).toBe('throttled');
    gate.release();
    expect((await first).body.github).toBe('refreshed');
    // requireConnected's own GET /user plus the profile read: the same two as one refresh.
    expect(userGets().length - calls).toBeLessThanOrEqual(2);
  });

  it('a failed read gives its claim back, so the next refresh is not made to wait', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    h.gh.userMode = 'status-500';
    await refresh(http, alice).expect(502);
    h.gh.userMode = 'ok';
    expect((await refresh(http, alice).expect(200)).body.github).toBe('refreshed');
  });

  it('GitHub refusing the token is 409 GITHUB_NOT_LINKED', async () => {
    const { http, alice } = await setup({ GITHUB_TOKEN_CACHE_S: '0' });
    h.gh.tokens.clear();
    const res = await refresh(http, alice).expect(409);
    expect(res.body.code).toBe('GITHUB_NOT_LINKED');
  });

  it('is under the import budget; a disconnect deletes what GitHub offered', async () => {
    const http = await h.start({ ...OPEN(), RATE_LIMIT_IMPORT: '2' });
    const alice = await h.connectedStudent(http, '100', 'alice');
    h.gh.profiles.set(100, { bio: 'Builds things' });
    await refresh(http, alice).expect(200);
    expect((await open(http, alice)).length).toBeGreaterThan(0);
    await http.delete('/v1/me/integrations/github').set(alice.auth).expect(200);
    expect(await open(http, alice)).toEqual([]);
    await refresh(http, alice).expect(200);
    const limited = await refresh(http, alice).expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });

  it('no token reaches a body or the log', async () => {
    const { http, alice } = await setup();
    const text: string[] = [];
    const keep = (r: { body: unknown }) => text.push(JSON.stringify(r.body));
    keep(await refresh(http, alice).expect(200));
    keep(await http.get('/v1/me/suggestions?status=all').set(alice.auth).expect(200));
    for (const t of [...text, h.logs.text()]) expect(t).not.toMatch(/gho_SENTINEL/);
  });
});

describe('a refresh and the world changing under it', () => {
  it('a disconnect forgets what was read through the connection: the next account is not offered the last one’s profile', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    await refresh(http, alice).expect(200);
    await http.delete('/v1/me/integrations/github').set(alice.auth).expect(200);
    const row = await db
      .selectFrom('integrations')
      .select(['suggestionsPolledAt', 'profileEtag', 'profileSnapshot'])
      .where('userId', '=', alice.id)
      .where('integrationType', '=', 'github')
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ suggestionsPolledAt: null, profileEtag: null, profileSnapshot: null });

    // Connected again (another account, in effect) inside the floor: GitHub is read, not the cache.
    h.linkedAtAuth0(alice.sub, '100', 'alice');
    await http.post('/v1/me/integrations/github/connect').set(alice.auth).expect(200);
    h.gh.profiles.set(100, { bio: 'The other account’s bio' });
    const again = await refresh(http, alice).expect(200);
    expect(again.body.github).toBe('refreshed');
    expect((await open(http, alice)).map((i) => i.proposed)).toEqual(['The other account’s bio']);
  });

  it('a disconnect that completes while GitHub is being asked is not undone by the answer (barrier)', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    const gate = h.gh.holdNextUser();
    const refreshing = refresh(http, alice).then((r) => r);
    await gate.arrived;
    await http.delete('/v1/me/integrations/github').set(alice.auth).expect(200);
    gate.release();

    const res = await refreshing;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ github: 'not_connected', created: 0, openCount: 0 });
    const rows = await db
      .selectFrom('suggestions')
      .select('id')
      .where('userId', '=', alice.id)
      .execute();
    expect(rows).toEqual([]);
    const state = await db
      .selectFrom('integrations')
      .select(['suggestionsPolledAt', 'profileSnapshot'])
      .where('userId', '=', alice.id)
      .where('integrationType', '=', 'github')
      .executeTakeFirstOrThrow();
    expect(state).toEqual({ suggestionsPolledAt: null, profileSnapshot: null });
  });

  it('a disconnect and a new connection while GitHub is being asked drop the answer too (barrier)', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    const gate = h.gh.holdNextUser();
    const refreshing = refresh(http, alice).then((r) => r);
    await gate.arrived;
    await http.delete('/v1/me/integrations/github').set(alice.auth).expect(200);
    h.linkedAtAuth0(alice.sub, '100', 'alice');
    await http.post('/v1/me/integrations/github/connect').set(alice.auth).expect(200);
    gate.release();

    const res = await refreshing;
    expect(res.body).toMatchObject({ github: 'discarded', created: 0 });
    const state = await db
      .selectFrom('integrations')
      .select(['suggestionsPolledAt', 'profileSnapshot'])
      .where('userId', '=', alice.id)
      .where('integrationType', '=', 'github')
      .executeTakeFirstOrThrow();
    expect(state).toEqual({ suggestionsPolledAt: null, profileSnapshot: null });
    // The claim was given back: the next refresh reads GitHub.
    expect((await refresh(http, alice).expect(200)).body.github).toBe('refreshed');
  });

  it('offers nothing from GitHub while a revocation is in flight, though a profile is stored', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '900' });
    await refresh(http, alice).expect(200);
    expect((await open(http, alice)).length).toBeGreaterThan(0);
    await db
      .updateTable('integrations')
      .set({ status: 'linking' })
      .where('userId', '=', alice.id)
      .where('integrationType', '=', 'github')
      .execute();
    await refresh(http, alice).expect(200);
    expect(await open(http, alice)).toEqual([]);
  });

  it('a field the student fills while GitHub is being asked is not offered as empty (barrier)', async () => {
    const { http, alice } = await setup();
    const gate = h.gh.holdNextUser();
    const refreshing = refresh(http, alice).then((r) => r);
    await gate.arrived;
    await db
      .updateTable('users')
      .set({ headline: 'CS undergraduate' })
      .where('id', '=', alice.id)
      .execute();
    gate.release();
    expect((await refreshing).status).toBe(200);
    const fields = (await open(http, alice)).map((i) => i.field);
    expect(fields).not.toContain('headline');
    expect(fields).toContain('bio');
  });
});

describe('LinkedIn sign-in claims and the re-import reminder', () => {
  async function linkedin(claims: Record<string, unknown>) {
    const sub = 'linkedin|li-1';
    const user = await createUser(db, { auth0Id: sub, name: 'Ani Old', avatarUrl: null });
    const token = await h.tenant.sign({ sub, profile: { identities: ['linkedin'], ...claims } });
    return { id: user.id, sub, auth: { Authorization: `Bearer ${token}` } };
  }

  it('offers a changed name and a photo from the claims, and accept applies the name', async () => {
    const http = await h.start(OPEN());
    const s = await linkedin({ name: 'Ani New', picture: 'https://media.licdn.com/p.jpg' });
    const res = await refresh(http, s).expect(200);
    expect(res.body.github).toBe('not_connected');
    const list = byField(await open(http, s));
    expect(list.name).toMatchObject({
      source: 'linkedin',
      current: 'Ani Old',
      proposed: 'Ani New',
    });
    expect(list.avatarUrl).toMatchObject({ mode: 'fill' });

    await http.post(`/v1/me/suggestions/${list.name!.id}/accept`).set(s.auth).expect(200);
    expect((await profileRow(s.id)).name).toBe('Ani New');
  });

  it('reminds to re-import when there was no export or it is old, once per quarter', async () => {
    const http = await h.start({ ...OPEN(), LINKEDIN_REIMPORT_DAYS: '90' });
    const s = await linkedin({});
    await refresh(http, s).expect(200);
    const first = (await open(http, s)).filter((i) => i.kind === 'linkedin.reimport');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ field: null, lastSyncedAt: null });
    // The quarter's key: refreshing again opens nothing new.
    expect((await refresh(http, s).expect(200)).body.created).toBe(0);

    await http.post(`/v1/me/suggestions/${first[0]!.id}/accept`).set(s.auth).expect(200);
    expect((await open(http, s)).filter((i) => i.kind === 'linkedin.reimport')).toEqual([]);
  });

  it('does not remind after a recent export', async () => {
    const http = await h.start({ ...OPEN(), LINKEDIN_REIMPORT_DAYS: '90' });
    const s = await linkedin({});
    await db
      .insertInto('integrations')
      .values({
        id: (await import('../../../core/db/ids.js')).newId(),
        userId: s.id,
        integrationType: 'linkedin',
        status: 'connected',
        lastSyncedAt: new Date(),
      })
      .execute();
    await refresh(http, s).expect(200);
    expect((await open(http, s)).filter((i) => i.kind === 'linkedin.reimport')).toEqual([]);
  });
});
