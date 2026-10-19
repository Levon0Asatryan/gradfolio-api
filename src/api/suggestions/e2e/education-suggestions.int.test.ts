import { describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { githubConnectHarness, type Http, type Student } from '../../../testing/github-connect.js';
import { db } from '../../../testing/team.js';

/**
 * M7-T25: `education.add` and `experience.add` suggestions against MySQL 8.4 with GitHub
 * as a fake over real HTTP. A verified address on a configured domain offers the
 * institution; a configured public organisation offers an organisation; neither when the
 * profile already holds the entry. An address is compared and dropped: it is in no
 * response, no log, no row.
 */

const h = githubConnectHarness();

const NAME = 'National Polytechnic University of Armenia';
// Fake addresses with a marker that must never be seen anywhere.
const MARK = 'zq-marker-7';
const POLY = `${MARK}@polytechnic.am`;

interface Item {
  id: string;
  kind: string;
  status: string;
  field: string | null;
  proposed: string | null;
}

const ENV = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...h.env(),
  RATE_LIMIT_IMPORT: '100',
  RATE_LIMIT_INTEGRATION: '100',
  SUGGESTIONS_MIN_INTERVAL_S: '0',
  SUGGESTIONS_NEW_REPOS: '0',
  UNIVERSITY_DOMAINS: 'polytechnic.am',
  UNIVERSITY_NAME: NAME,
  ...over,
});

async function setup(over: NodeJS.ProcessEnv = {}) {
  const http = await h.start(ENV(over));
  const alice = await h.connectedStudent(http, '100', 'alice');
  const bob = await h.connectedStudent(http, '200', 'bob');
  return { http, alice, bob };
}

const refresh = (http: Http, s: Student) => http.post('/v1/me/suggestions/refresh').set(s.auth);
const entryRows = async (http: Http, s: Student, status = 'open'): Promise<Item[]> =>
  (
    (await http.get(`/v1/me/suggestions?status=${status}`).set(s.auth).expect(200)).body as {
      items: Item[];
    }
  ).items.filter((i) => i.kind === 'education.add' || i.kind === 'experience.add');
const accept = (http: Http, s: Student, id: string, body?: object) => {
  const req = http.post(`/v1/me/suggestions/${id}/accept`).set(s.auth);
  return body === undefined ? req : req.send(body);
};
const emailCalls = () => h.gh.requests.filter((r) => r.path === '/user/emails');
const orgCalls = () => h.gh.requests.filter((r) => r.path.endsWith('/orgs'));
const educationOf = (s: Student) =>
  db.selectFrom('education').selectAll().where('userId', '=', s.id).execute();
const experienceOf = (s: Student) =>
  db.selectFrom('experience').selectAll().where('userId', '=', s.id).execute();
const addEducation = (s: Student, institution: string) =>
  db
    .insertInto('education')
    .values({ id: newId(), userId: s.id, institution, degree: 'BSc', field: 'CS', startYear: 2020 })
    .execute();

const DEGREE = { degree: 'BSc', field: 'Computer Science', startYear: 2022, endYear: 2026 };

describe('which institution is offered', () => {
  it('a verified address on the domain: one education.add with the configured name; unverified: none', async () => {
    const { http, alice, bob } = await setup();
    h.gh.emails.set(100, [
      { email: 'someone@example.com', verified: true },
      { email: POLY, verified: true },
    ]);
    h.gh.emails.set(200, [{ email: `bob-${MARK}@polytechnic.am`, verified: false }]);

    const res = await refresh(http, alice).expect(200);
    expect(res.body).toMatchObject({ github: 'refreshed', created: 1 });
    const rows = await entryRows(http, alice);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'education.add',
      field: 'education',
      proposed: NAME,
      status: 'open',
    });
    // Nothing is written until an accept.
    expect(await educationOf(alice)).toEqual([]);

    expect((await refresh(http, bob).expect(200)).body.created).toBe(0);
    expect(await entryRows(http, bob)).toEqual([]);
  });

  it.each([
    [`a.${MARK}@cs.polytechnic.am`, true],
    [`${MARK}@POLYTECHNIC.AM`, true],
    [`${MARK}@evilpolytechnic.am`, false],
    [`${MARK}@polytechnic.am.evil.com`, false],
    [`${MARK}@polytechnic.am@evil.com`, false],
    [`"${MARK}@polytechnic.am"@evil.com`, false],
  ])('%s -> offered: %s', async (email, offered) => {
    const { http, alice } = await setup();
    h.gh.emails.set(100, [{ email, verified: true }]);
    await refresh(http, alice).expect(200);
    expect(await entryRows(http, alice)).toHaveLength(offered ? 1 : 0);
  });

  it('is empty-state only: an education entry for the same institution blocks it', async () => {
    const { http, alice } = await setup();
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    await addEducation(alice, `  national POLYTECHNIC university of   armenia `);
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
    expect(await entryRows(http, alice)).toEqual([]);
  });

  it('an entry for another institution does not block it', async () => {
    const { http, alice } = await setup();
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    await addEducation(alice, 'Yerevan State University');
    expect((await refresh(http, alice).expect(200)).body.created).toBe(1);
  });

  it('GitHub not showing the emails (no scope) is no evidence and no failure', async () => {
    const { http, alice } = await setup();
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    h.gh.emailsMode = 'no-scope';
    try {
      expect((await refresh(http, alice).expect(200)).body).toMatchObject({
        github: 'refreshed',
        created: 0,
      });
    } finally {
      h.gh.emailsMode = 'ok';
    }
  });

  it('an address that stops being verified withdraws the open suggestion', async () => {
    const { http, alice } = await setup();
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    await refresh(http, alice).expect(200);
    expect(await entryRows(http, alice)).toHaveLength(1);
    h.gh.emails.set(100, [{ email: POLY, verified: false }]);
    await refresh(http, alice).expect(200);
    expect(await entryRows(http, alice)).toEqual([]);
    expect(await entryRows(http, alice, 'all')).toMatchObject([{ status: 'superseded' }]);
  });

  it('reads the emails once per refresh, none when unconfigured, none inside the floor', async () => {
    const { http, alice } = await setup({ SUGGESTIONS_MIN_INTERVAL_S: '600' });
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    const before = emailCalls().length;
    await refresh(http, alice).expect(200);
    expect(emailCalls().length - before).toBe(1);
    // Inside the floor GitHub is not asked, and the open suggestion is kept.
    expect((await refresh(http, alice).expect(200)).body.github).toBe('throttled');
    expect(emailCalls().length - before).toBe(1);
    expect(await entryRows(http, alice)).toHaveLength(1);
    expect(orgCalls()).toHaveLength(0);
  });

  it('with no domain configured, no email is read and nothing is offered', async () => {
    const { http, alice } = await setup({ UNIVERSITY_DOMAINS: '', UNIVERSITY_NAME: '' });
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    const before = emailCalls().length;
    await refresh(http, alice).expect(200);
    expect(emailCalls().length - before).toBe(0);
    expect(await entryRows(http, alice)).toEqual([]);
  });
});

describe('accept and dismiss', () => {
  it('needs the degree, field and start year; adds the entry with the configured name', async () => {
    const { http, alice } = await setup();
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    await refresh(http, alice).expect(200);
    const [row] = await entryRows(http, alice);

    // Without them: 400 naming the fields; the suggestion stays open, nothing is written.
    const bad = await accept(http, alice, row!.id).expect(400);
    expect(JSON.stringify(bad.body)).toContain('overrides.degree');
    await accept(http, alice, row!.id, { overrides: { degree: 'BSc' } }).expect(400);
    // The institution is not the student's to change here.
    await accept(http, alice, row!.id, {
      overrides: { ...DEGREE, institution: 'Elsewhere' },
    }).expect(400);
    expect(await educationOf(alice)).toEqual([]);
    expect((await entryRows(http, alice))[0]!.status).toBe('open');

    const ok = await accept(http, alice, row!.id, { overrides: DEGREE }).expect(200);
    expect(ok.body).toMatchObject({
      status: 'accepted',
      applied: { field: 'education', value: NAME },
    });
    const entries = await educationOf(alice);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      institution: NAME,
      degree: 'BSc',
      field: 'Computer Science',
      startYear: 2022,
      endYear: 2026,
    });

    // A retry reports the same and adds nothing.
    await accept(http, alice, row!.id, { overrides: DEGREE }).expect(200);
    expect(await educationOf(alice)).toHaveLength(1);
    // An accepted key is never offered again, even with the entry gone.
    await db.deleteFrom('education').where('userId', '=', alice.id).execute();
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
  });

  it('an entry added since the offer: 409 SUGGESTION_STALE, superseded, no duplicate', async () => {
    const { http, alice } = await setup();
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    await refresh(http, alice).expect(200);
    const [row] = await entryRows(http, alice);
    await addEducation(alice, NAME.toUpperCase());

    const res = await accept(http, alice, row!.id, { overrides: DEGREE }).expect(409);
    expect(res.body).toMatchObject({ code: 'SUGGESTION_STALE' });
    expect(await educationOf(alice)).toHaveLength(1);
    expect((await entryRows(http, alice, 'all'))[0]!.status).toBe('superseded');
  });

  it('a disconnect deletes the open suggestion', async () => {
    const { http, alice } = await setup();
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    await refresh(http, alice).expect(200);
    expect(await entryRows(http, alice)).toHaveLength(1);
    await http.delete('/v1/me/integrations/github').set(alice.auth).expect(200);
    expect(await entryRows(http, alice)).toEqual([]);
  });

  it('a dismissed suggestion is not offered again', async () => {
    const { http, alice } = await setup();
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    await refresh(http, alice).expect(200);
    const [row] = await entryRows(http, alice);
    await http.post(`/v1/me/suggestions/${row!.id}/dismiss`).set(alice.auth).expect(200);
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
    expect(await entryRows(http, alice)).toEqual([]);
  });

  it('another user gets 404 on accept and dismiss, and nothing changes', async () => {
    const { http, alice, bob } = await setup();
    h.gh.emails.set(100, [{ email: POLY, verified: true }]);
    await refresh(http, alice).expect(200);
    const [row] = await entryRows(http, alice);
    await accept(http, bob, row!.id, { overrides: DEGREE }).expect(404);
    await http.post(`/v1/me/suggestions/${row!.id}/dismiss`).set(bob.auth).expect(404);
    expect(await educationOf(bob)).toEqual([]);
    expect((await entryRows(http, alice))[0]!.status).toBe('open');
  });

  it('other kinds take no overrides', async () => {
    const { http, alice } = await setup();
    h.gh.socialAccounts.set(100, [
      { provider: 'linkedin', url: 'https://www.linkedin.com/in/alice-example' },
    ]);
    await refresh(http, alice).expect(200);
    const items = (await http.get('/v1/me/suggestions').set(alice.auth).expect(200)).body as {
      items: Item[];
    };
    const link = items.items.find((i) => i.kind === 'profile.links.linkedin')!;
    await accept(http, alice, link.id, { overrides: DEGREE }).expect(400);
    await accept(http, alice, link.id, { overrides: {} }).expect(400);
    await accept(http, alice, link.id).expect(200);
  });
});

describe('organisations', () => {
  const ORGS = { UNIVERSITY_ORGS: 'Poly-Club=Polytechnic Club' };

  it('a configured public organisation is offered as experience.add; others are not', async () => {
    const { http, alice, bob } = await setup(ORGS);
    h.gh.orgs.set('alice', ['poly-club', 'some-other-org']);
    h.gh.orgs.set('bob', ['some-other-org']);

    expect((await refresh(http, alice).expect(200)).body.created).toBe(1);
    const rows = await entryRows(http, alice);
    expect(rows).toMatchObject([
      { kind: 'experience.add', field: 'experience', proposed: 'Polytechnic Club' },
    ]);
    expect((await refresh(http, bob).expect(200)).body.created).toBe(0);
    // Of the student's organisations only the configured one is anywhere in the database.
    const stored = JSON.stringify(
      await db.selectFrom('suggestions').select('payload').where('userId', '=', alice.id).execute(),
    );
    expect(stored).not.toContain('some-other-org');
  });

  it('a renamed organisation withdraws the old offer and makes a new one', async () => {
    const { http, alice } = await setup(ORGS);
    h.gh.orgs.set('alice', ['poly-club']);
    await refresh(http, alice).expect(200);
    // The row as an earlier configuration made it: another display name, so another key.
    await db
      .updateTable('suggestions')
      .set({
        dedupeKey: 'experience:org:poly-club:00000000',
        payload: JSON.stringify({ field: 'experience', value: 'Old Name' }) as never,
      })
      .where('userId', '=', alice.id)
      .execute();
    expect((await entryRows(http, alice)).map((r) => r.proposed)).toEqual(['Old Name']);
    await refresh(http, alice).expect(200);
    expect((await entryRows(http, alice)).map((r) => r.proposed)).toEqual(['Polytechnic Club']);
    const all = await entryRows(http, alice, 'all');
    expect(all.map((r) => [r.proposed, r.status]).sort()).toEqual([
      ['Old Name', 'superseded'],
      ['Polytechnic Club', 'open'],
    ]);
  });

  it('accept needs the title and start; adds the entry named by the organisation', async () => {
    const { http, alice } = await setup(ORGS);
    h.gh.orgs.set('alice', ['poly-club']);
    await refresh(http, alice).expect(200);
    const [row] = await entryRows(http, alice);
    await accept(http, alice, row!.id).expect(400);
    // Education's fields do not apply to it.
    await accept(http, alice, row!.id, { overrides: DEGREE }).expect(400);
    const ok = await accept(http, alice, row!.id, {
      overrides: { title: 'Member', start: '2023-09' },
    }).expect(200);
    expect(ok.body).toMatchObject({ applied: { field: 'experience', value: 'Polytechnic Club' } });
    expect(await experienceOf(alice)).toMatchObject([
      { organization: 'Polytechnic Club', title: 'Member', start: '2023-09', end: null },
    ]);
  });

  it('is empty-state only: an experience entry for the organisation blocks it', async () => {
    const { http, alice } = await setup(ORGS);
    h.gh.orgs.set('alice', ['poly-club']);
    await db
      .insertInto('experience')
      .values({
        id: newId(),
        userId: alice.id,
        title: 'Member',
        organization: 'polytechnic club',
        start: '2022-01',
        summary: '',
      })
      .execute();
    expect((await refresh(http, alice).expect(200)).body.created).toBe(0);
  });

  it('costs two calls per refresh (who, then the organisations) and none when unconfigured', async () => {
    const { http, alice } = await setup(ORGS);
    h.gh.orgs.set('alice', ['poly-club']);
    const users = () => h.gh.requests.filter((r) => r.path === '/user').length;
    const before = { orgs: orgCalls().length, users: users() };
    await refresh(http, alice).expect(200);
    expect(orgCalls().length - before.orgs).toBe(1);
    // The profile read, plus the one that asks who the token is.
    expect(users() - before.users).toBe(2);
  });

  it('with no organisation configured, no organisation is read', async () => {
    const { http, alice } = await setup();
    h.gh.orgs.set('alice', ['poly-club']);
    await refresh(http, alice).expect(200);
    expect(orgCalls()).toHaveLength(0);
  });
});

describe('no address anywhere', () => {
  it('is in no response, no log and no row, through refresh, list, accept and dismiss', async () => {
    const { http, alice } = await setup({ UNIVERSITY_ORGS: 'poly-club' });
    h.logs.clear();
    h.gh.emails.set(100, [
      { email: POLY, verified: true },
      { email: `other-${MARK}@example.com`, verified: true },
      { email: `unverified-${MARK}@polytechnic.am`, verified: false },
    ]);
    h.gh.orgs.set('alice', ['poly-club']);
    const texts: string[] = [];
    const keep = <T extends { text: string }>(res: T): T => {
      texts.push(res.text);
      return res;
    };

    keep(await refresh(http, alice).expect(200));
    const list = keep(await http.get('/v1/me/suggestions?status=all').set(alice.auth).expect(200));
    const rows = (list.body as { items: Item[] }).items;
    expect(rows).toHaveLength(2);
    keep(await accept(http, alice, rows[0]!.id).expect(400));
    keep(await accept(http, alice, rows[0]!.id, { overrides: DEGREE }));
    keep(await http.post(`/v1/me/suggestions/${rows[1]!.id}/dismiss`).set(alice.auth));
    // A failing read names no address either.
    h.gh.emailsMode = 'bad-body';
    try {
      keep(await refresh(http, alice));
    } finally {
      h.gh.emailsMode = 'ok';
    }
    texts.push(h.logs.text());
    texts.push(
      JSON.stringify(await db.selectFrom('suggestions').selectAll().execute()),
      JSON.stringify(await db.selectFrom('notifications').selectAll().execute()),
      JSON.stringify(await educationOf(alice)),
      JSON.stringify(await db.selectFrom('users').selectAll().execute()),
    );
    for (const t of texts) {
      expect(t).not.toContain(MARK);
      expect(t).not.toMatch(/@polytechnic\.am|@example\.com/);
    }
  });
});
