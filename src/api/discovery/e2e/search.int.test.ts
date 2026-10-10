import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../core/db/database.js';
import { DbService } from '../../../core/db/db.service.js';
import { setUserSkills } from '../../../core/db/terms.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { canonicalObjectUrl } from '../../../core/storage/file-rules.js';
import { OPERATIONS } from '../../openapi/document.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig } from '../../../testing/database.js';
import { createProject } from '../../../testing/factories.js';
import { FakeFileStorage } from '../../../testing/fake-storage.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { addMember, db, person, type Person } from '../../../testing/team.js';

/**
 * M6 PR (a): public search and tag pages against MySQL 8.4 -- the privacy matrix
 * (X1-X4), short words and stopwords (X9), case, ё/е and Armenian (X10),
 * hostile input (X8), cursors (X11), tag names (X12), fixed statement counts
 * and signing once per file (docs/m6-plan.md §7, §8, §10).
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();
const BUCKET = 'test-bucket';

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
beforeEach(async () => {
  await db.deleteFrom('users').execute();
  await db.deleteFrom('terms').execute();
});
afterEach(async () => {
  logs.clear();
  await app?.close();
  app = undefined;
});

async function start(env: NodeJS.ProcessEnv = {}, storage?: FakeFileStorage) {
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'warn',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
      // The matrix makes many requests from one address.
      RATE_LIMIT_DEFAULT: '10000',
      RATE_LIMIT_DEFAULT_SHARED: '10000',
      RATE_LIMIT_SEARCH: '10000',
      RATE_LIMIT_SEARCH_SHARED: '10000',
      RATE_LIMIT_BROWSE: '10000',
      RATE_LIMIT_BROWSE_SHARED: '10000',
      ...env,
    }),
    undefined,
    { logs, ...(storage ? { storage } : {}) },
  );
  return request(app.getHttpServer());
}
type Http = Awaited<ReturnType<typeof start>>;

const who = (label: string, over: Parameters<typeof person>[2] = {}) => person(tenant, label, over);
const skills = (userId: string, list: string[]) =>
  inTransaction(db, (trx) => setUserSkills(trx, userId, list));

interface PersonItem {
  id: string;
  name: string;
  headline: string;
  avatarUrl: string | null;
  verified: boolean;
  location: string | null;
  skills: string[];
  projectCount: number;
}
interface CardItem {
  id: string;
  title: string;
  owner: { id: string; name: string; avatarUrl: string | null };
  technologies: string[];
  tags: string[];
  heroImageUrl: string | null;
}
interface Grouped {
  query: string;
  people: { items: PersonItem[]; hasMore: boolean };
  projects: { items: CardItem[]; hasMore: boolean };
}

/**
 * The scene: public people (English, Russian, Armenian), a private profile,
 * and published, private, draft, private-owner, pending- and accepted-member
 * projects, each named so a leak is readable in the failure.
 */
async function scene() {
  const alice = await who('Alice Smith', { headline: 'ML engineer' });
  const bob = await who('Bob Brown', { headline: 'UI/UX designer' });
  const hidden = await who('Zed Hidden', { headline: 'ML engineer', isPublic: false });
  const armen = await who('Արմեն Ասատրյան', { headline: 'Ծրագրավորող' });
  const alena = await who('Алёна Иванова', { headline: 'Дизайнер' });
  const fedor = await who('Фёдор Смирнов', { headline: 'Developer' });
  const viewer = await who('Viewer Nobody');
  await skills(alice.user.id, ['ML', 'C#', 'Go', 'R']);
  // The exact one-character terms `a` and `i`, beside rows whose *text* has the words
  // "a" and "i": only an exact-term rule tells them apart from a dropped stopword.
  await skills(bob.user.id, ['AI', 'React', 'a']);
  await skills(hidden.user.id, ['ML', 'AI', 'Go', 'SecretTool']);
  await skills(armen.user.id, ['Գրաֆիկ դիզայն']);
  await skills(alena.user.id, ['Python', 'i']);
  await skills(fedor.user.id, ['IoT']);

  const mk = (owner: Person, title: string, o: Parameters<typeof createProject>[2] = {}) =>
    createProject(db, owner.user, { title, ...o }).then((r) => r.project);
  const p = {
    pub: await mk(alice, 'IoT Garden', {
      summary: 'Smart garden with AI assistance. Backend written in Go and C#.',
      technologies: ['IoT', 'Go', 'C#'],
      tags: ['web'],
    }),
    priv: await mk(alice, 'IoT Secret Plans', {
      isPublic: false,
      technologies: ['ML', 'IoT', 'SecretTool'],
    }),
    draft: await mk(alice, 'IoT Draft Notes', { isDraft: true, technologies: ['IoT'] }),
    hiddenOwner: await mk(hidden, 'IoT Hidden Owner', { technologies: ['IoT', 'ML'] }),
    bait: await mk(alice, 'Main Email', {
      summary: 'the main email chain; an algorithm from long ago',
      technologies: ['TypeScript'],
    }),
    ml: await mk(bob, 'ML Classifier', {
      summary: 'machine learning for images',
      technologies: ['ML'],
    }),
    chat: await mk(bob, 'Chat Application', {
      summary: 'a realtime chat app',
      technologies: ['React'],
    }),
    elka: await mk(alena, 'Ёлочная гирлянда', { summary: 'ESP32', technologies: ['IoT'] }),
    am: await mk(armen, 'Խելացի այգի', { summary: 'ավտոմատ', technologies: ['IoT'] }),
    tiny: await mk(armen, 'Tiny Term', { summary: 'two letters', technologies: ['a', 'i'] }),
    robot: await mk(armen, 'I Robot', { summary: 'i built a robot', technologies: ['Rust'] }),
    teamPriv: await mk(alice, 'Team Secret', { isPublic: false, technologies: ['AI'] }),
    teamPub: await mk(alice, 'Team Public', { technologies: ['Rust'] }),
  };
  await addMember(p.teamPriv.id, bob.user.id, 'accepted');
  await addMember(p.teamPub.id, bob.user.id, 'accepted');
  await addMember(p.teamPub.id, fedor.user.id, 'pending');
  return { alice, bob, hidden, armen, alena, fedor, viewer, p };
}
type Scene = Awaited<ReturnType<typeof scene>>;

/** What an anonymous visitor, another user and the owner of the private work each get. */
const viewersOf = (s: Scene) =>
  [
    ['anonymous', {} as Record<string, string>],
    ['another user', s.viewer.auth as Record<string, string>],
    ['the owner', s.alice.auth as Record<string, string>],
  ] as const;

const names = (xs: { name: string }[]) => xs.map((x) => x.name).toSorted();
const titles = (xs: { title: string }[]) => xs.map((x) => x.title).toSorted();

/** Runs `check` for every viewer; the response must not depend on who asks (N1). */
async function everyone<T>(s: Scene, http: Http, path: string, query: Record<string, string>) {
  const bodies: T[] = [];
  for (const [, headers] of viewersOf(s)) {
    const res = await http.get(path).query(query).set(headers).expect(200);
    bodies.push(res.body as T);
  }
  for (const b of bodies) expect(b).toEqual(bodies[0]);
  return bodies[0]!;
}

const LEAKS = ['Secret', 'Draft', 'Hidden', 'Zed', 'SecretTool'];

describe('GET /v1/search: the privacy matrix (X1-X4)', () => {
  it('finds published work of public people only, the same for anonymous, another user and the owner', async () => {
    const s = await scene();
    const http = await start();
    const r = await everyone<Grouped>(s, http, '/v1/search', { q: 'IoT' });
    expect(titles(r.projects.items)).toEqual(
      ['IoT Garden', 'Խելացի այգի', 'Ёлочная гирлянда'].toSorted(),
    );
    expect(names(r.people.items)).toEqual(['Фёдор Смирнов']);
    const text = JSON.stringify(r);
    for (const leak of LEAKS) expect(text).not.toContain(leak);
  });

  it('keeps a private profile out of people search, by name, headline and skill', async () => {
    const s = await scene();
    const http = await start();
    for (const q of ['Zed', 'Hidden', 'SecretTool']) {
      const r = await everyone<Grouped>(s, http, '/v1/search', { q });
      expect(r.people.items).toEqual([]);
      expect(r.projects.items).toEqual([]);
    }
    const ml = await everyone<Grouped>(s, http, '/v1/search', { q: 'ML' });
    expect(names(ml.people.items)).toEqual(['Alice Smith']);
  });

  it('keeps a published project of a private profile out of discovery while its direct read still works (X3)', async () => {
    const s = await scene();
    const http = await start();
    const r = await everyone<Grouped>(s, http, '/v1/search/projects', { q: 'Hidden Owner' });
    expect((r as unknown as { items: unknown[] }).items).toEqual([]);
    await http.get(`/v1/projects/${s.p.hiddenOwner.id}`).expect(200);
  });

  it('counts an accepted team member’s published projects and nothing private or pending (X4)', async () => {
    const s = await scene();
    const http = await start();
    const r = await everyone<{ items: PersonItem[] }>(s, http, '/v1/search/people', { q: 'Brown' });
    const bob = r.items.find((x) => x.name === 'Bob Brown')!;
    // own: ML Classifier, Chat Application; member: Team Public. Not Team Secret (private).
    expect(bob.projectCount).toBe(3);
    const fedor = (await http.get('/v1/search/people').query({ q: 'Смирнов' }).expect(200))
      .body as { items: PersonItem[] };
    expect(fedor.items[0]!.projectCount).toBe(0); // a pending invite counts for nothing
    const alice = (await http.get('/v1/search/people').query({ q: 'Smith' }).expect(200)).body as {
      items: PersonItem[];
    };
    // IoT Garden, Main Email, Team Public: not the private, draft or team-private ones
    expect(alice.items[0]!.projectCount).toBe(3);
  });

  it('shows no private field and no more than the card’s fields', async () => {
    const s = await scene();
    const http = await start();
    const r = await everyone<Grouped>(s, http, '/v1/search', { q: 'ML' });
    expect(Object.keys(r.people.items[0]!).toSorted()).toEqual([
      'avatarUrl',
      'headline',
      'id',
      'location',
      'name',
      'projectCount',
      'skills',
      'verified',
    ]);
    expect(Object.keys(r.projects.items[0]!).toSorted()).toEqual([
      'category',
      'createdAt',
      'heroImageUrl',
      'id',
      'owner',
      'status',
      'summary',
      'tags',
      'technologies',
      'title',
      'updatedAt',
    ]);
    expect(Object.keys(r.projects.items[0]!.owner).toSorted()).toEqual(['avatarUrl', 'id', 'name']);
    const text = JSON.stringify(r);
    for (const k of [
      'birthday',
      'phone',
      'auth0',
      'email',
      'contactEmail',
      'accessToken',
      'descriptionHtml',
      'isDraft',
      'isPublic',
    ]) {
      expect(text).not.toContain(k);
    }
  });
});

describe('GET /v1/search: short words, stopwords, case, ё/е, Armenian (X9, X10)', () => {
  it.each([
    ['ML', ['Alice Smith'], ['ML Classifier']],
    ['AI', ['Bob Brown'], ['IoT Garden']],
    ['Go', ['Alice Smith'], ['IoT Garden']],
    ['C#', ['Alice Smith'], ['IoT Garden']],
    ['R', ['Alice Smith'], []],
    ['IoT', ['Фёдор Смирнов'], ['IoT Garden', 'Խելացի այգի', 'Ёлочная гирлянда']],
  ])(
    'finds %s by registered term and word start, and not by a substring of another word',
    async (q, people, projects) => {
      const s = await scene();
      const http = await start();
      const r = await everyone<Grouped>(s, http, '/v1/search', { q });
      expect(names(r.people.items)).toEqual(people.toSorted());
      expect(titles(r.projects.items)).toEqual(projects.toSorted());
      // "Main Email" holds the substrings ai (m-ai-n), go (a-go) and ml-free text: never found.
      expect(titles(r.projects.items)).not.toContain('Main Email');
    },
  );

  it('is case-insensitive for terms', async () => {
    const s = await scene();
    const http = await start();
    const base = await everyone<Grouped>(s, http, '/v1/search', { q: 'ML' });
    for (const q of ['ml', 'Ml', 'mL', 'iot']) {
      const r = await everyone<Grouped>(s, http, '/v1/search', { q });
      if (q.toLowerCase() === 'ml') expect(r).toMatchObject({ people: base.people });
      expect(r.query).toBe(q);
    }
  });

  it('finds Russian names and titles with ё or е in any case, and Armenian in any case', async () => {
    const s = await scene();
    const http = await start();
    for (const q of ['Алёна', 'алена', 'АЛЕНА', 'алёна']) {
      const r = await everyone<Grouped>(s, http, '/v1/search', { q });
      expect(names(r.people.items), q).toEqual(['Алёна Иванова']);
    }
    for (const q of ['Фёдор', 'федор']) {
      const r = await everyone<Grouped>(s, http, '/v1/search', { q });
      expect(names(r.people.items), q).toEqual(['Фёдор Смирнов']);
    }
    for (const q of ['Ёлочная', 'елочная', 'ЕЛОЧНАЯ']) {
      const r = await everyone<Grouped>(s, http, '/v1/search', { q });
      expect(titles(r.projects.items), q).toEqual(['Ёлочная гирлянда']);
    }
    for (const q of ['Արմեն', 'ԱՐՄԵՆ', 'արմեն', 'Խելացի', 'ԽԵԼԱՑԻ']) {
      const r = await everyone<Grouped>(s, http, '/v1/search', { q });
      expect(r.people.items.length + r.projects.items.length, q).toBeGreaterThan(0);
    }
    const am = await everyone<Grouped>(s, http, '/v1/search', { q: 'ԱՐՄԵՆ' });
    expect(names(am.people.items)).toEqual(['Արմեն Ասատրյան']);
  });

  it('ignores a stopword beside other words, so "the chat" and "an app" find chat and app', async () => {
    const s = await scene();
    const http = await start();
    const chat = await everyone<Grouped>(s, http, '/v1/search', { q: 'the chat' });
    expect(titles(chat.projects.items)).toEqual(['Chat Application']);
    const app_ = await everyone<Grouped>(s, http, '/v1/search', { q: 'an app' });
    expect(titles(app_.projects.items)).toEqual(['Chat Application']);
  });

  it('answers a stopwords-only query by word start', async () => {
    const s = await scene();
    const http = await start();
    const the = await everyone<Grouped>(s, http, '/v1/search', { q: 'the' });
    // word start in title or summary: only "the main email chain…" has a word starting "the"
    expect(titles(the.projects.items)).toEqual(['Main Email']);
  });

  it('matches a single stopword letter by exact term only: not dropped, and not a word start', async () => {
    const s = await scene();
    const http = await start();
    // `a` is a skill of Bob and a technology of "Tiny Term". The words "a" and "i" are in
    // "Chat Application" ("a realtime chat app") and "I Robot" ("i built a robot"): a rule
    // that drops every stopword returns nothing, one that word-starts returns those.
    const a = await everyone<Grouped>(s, http, '/v1/search', { q: 'a' });
    expect(names(a.people.items)).toEqual(['Bob Brown']);
    expect(titles(a.projects.items)).toEqual(['Tiny Term']);
    const i = await everyone<Grouped>(s, http, '/v1/search', { q: 'i' });
    expect(names(i.people.items)).toEqual(['Алёна Иванова']);
    expect(titles(i.projects.items)).toEqual(['Tiny Term']);
    // beside another word, the stopword letter is dropped: "a chat" is "chat"
    const chat = await everyone<Grouped>(s, http, '/v1/search', { q: 'a chat' });
    expect(titles(chat.projects.items)).toEqual(['Chat Application']);
  });

  it('requires every word (AND across words)', async () => {
    const s = await scene();
    const http = await start();
    const r = await everyone<Grouped>(s, http, '/v1/search', { q: 'machine learning' });
    expect(titles(r.projects.items)).toEqual(['ML Classifier']);
    const none = await everyone<Grouped>(s, http, '/v1/search', { q: 'machine garden' });
    expect(none.projects.items).toEqual([]);
  });

  it('puts an exact name or title before a partial one', async () => {
    const s = await scene();
    await createProject(db, s.bob.user, { title: 'Chat', summary: 'x' });
    const http = await start();
    const r = await everyone<Grouped>(s, http, '/v1/search', { q: 'Chat' });
    expect(r.projects.items.map((p) => p.title)).toEqual(['Chat', 'Chat Application']);
  });
});

describe('freshness: edits, deletions and visibility changes show at once', () => {
  it('follows a rename, a delete, a privacy switch and a skill change', async () => {
    const s = await scene();
    const http = await start();
    const found = async (path: string, q: string) =>
      ((await http.get(path).query({ q }).expect(200)).body.items as { id: string }[]).map(
        (i) => i.id,
      );
    const proj = await createProject(db, s.bob.user, { title: 'Zebra Quartz', summary: 'stripes' });
    expect(await found('/v1/search/projects', 'zebra')).toEqual([proj.project.id]);

    await db
      .updateTable('projects')
      .set({ title: 'Giraffe Spots' })
      .where('id', '=', proj.project.id)
      .execute();
    expect(await found('/v1/search/projects', 'zebra')).toEqual([]);
    expect(await found('/v1/search/projects', 'giraffe')).toEqual([proj.project.id]);

    await db
      .updateTable('projects')
      .set({ isPublic: false })
      .where('id', '=', proj.project.id)
      .execute();
    expect(await found('/v1/search/projects', 'giraffe')).toEqual([]);
    await db
      .updateTable('projects')
      .set({ isPublic: true })
      .where('id', '=', proj.project.id)
      .execute();
    expect(await found('/v1/search/projects', 'giraffe')).toEqual([proj.project.id]);

    await db.deleteFrom('projects').where('id', '=', proj.project.id).execute();
    expect(await found('/v1/search/projects', 'giraffe')).toEqual([]);

    await db
      .updateTable('users')
      .set({ name: 'Bobby Renamed' })
      .where('id', '=', s.bob.user.id)
      .execute();
    expect(await found('/v1/search/people', 'Brown')).toEqual([]);
    expect(await found('/v1/search/people', 'Renamed')).toEqual([s.bob.user.id]);
    await db
      .updateTable('users')
      .set({ isPublic: false })
      .where('id', '=', s.bob.user.id)
      .execute();
    expect(await found('/v1/search/people', 'Renamed')).toEqual([]);
    // and his projects leave discovery with his profile (D5)
    expect(await found('/v1/search/projects', 'Classifier')).toEqual([]);
    await http.get(`/v1/projects/${s.p.ml.id}`).expect(200); // the direct read is unchanged

    await skills(s.alice.user.id, ['Go']);
    expect(await found('/v1/search/people', 'C#')).toEqual([]);
    expect(await found('/v1/search/people', 'go')).toEqual([s.alice.user.id]);
  });
});

describe('hostile input (X8)', () => {
  it.each([
    '+(',
    '"unterminated',
    '@3',
    '*',
    '>',
    '++machine',
    '-machine',
    'machine*bad',
    '+machine -',
    "'; DROP TABLE users; --",
    '50%',
    '_',
    '\\',
    'a\u0000b',
    '\ud800',
    '😀 emoji',
    'Ῥωμαίοι Ö ß ı İ',
  ])('answers 200 for %j and never a 500', async (q) => {
    await scene();
    const http = await start();
    for (const path of ['/v1/search', '/v1/search/people', '/v1/search/projects']) {
      const res = await http.get(path).query({ q });
      expect([200, 400], `${path} ${JSON.stringify(q)}`).toContain(res.status);
    }
  });

  it('treats % and _ as text, not wildcards', async () => {
    const s = await scene();
    await createProject(db, s.bob.user, { title: '100% Pure', summary: 'x' });
    const http = await start();
    const pct = await http.get('/v1/search/projects').query({ q: '100%' }).expect(200);
    expect(titles(pct.body.items)).toEqual(['100% Pure']);
    // an unescaped % or _ would make these match "100% Pure"
    for (const q of ['1%', '1_0%', '%00%']) {
      const none = await http.get('/v1/search/projects').query({ q }).expect(200);
      expect(none.body.items, q).toEqual([]);
    }
  });

  it.each([
    ['no q', {}],
    ['a blank q', { q: '   ' }],
    ['101 characters', { q: 'a'.repeat(101) }],
    ['7 words', { q: 'a b c d e f g' }],
    ['a 51-character word', { q: 'x'.repeat(51) }],
    ['an unknown key', { q: 'ml', sort: 'newest' }],
    ['q given twice', { q: ['ml', 'ai'] }],
    ['a limit of 0', { q: 'ml', limit: '0' }],
    ['a limit over the maximum', { q: 'ml', limit: '31' }],
  ])('answers 400 VALIDATION_FAILED for %s', async (_n, query) => {
    const http = await start();
    for (const path of ['/v1/search/people', '/v1/search/projects']) {
      const res = await http.get(path).query(query).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('answers 401 for a token that is sent and bad, and serves one that is good', async () => {
    const s = await scene();
    const http = await start();
    await http.get('/v1/search').query({ q: 'ml' }).set('Authorization', 'Bearer junk').expect(401);
    await http.get('/v1/search').query({ q: 'ml' }).set(s.viewer.auth).expect(200);
  });
});

describe('pagination and cursors (X11)', () => {
  async function many(s: Scene, n: number) {
    const at = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < n; i++) {
      await createProject(db, s.bob.user, {
        title: `Pager ${String(i).padStart(2, '0')}`,
        technologies: ['PagerTerm'],
        // pairs share a timestamp, so the id must break the tie
        createdAt: new Date(at.getTime() + Math.floor(i / 2) * 60_000),
      });
    }
  }
  async function walk(http: Http, path: string, query: Record<string, string>, limit: number) {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 30; guard++) {
      const res = await http
        .get(path)
        .query({ ...query, limit: String(limit), ...(cursor ? { cursor } : {}) })
        .expect(200);
      const body = res.body as { items: { id: string }[]; nextCursor: string | null };
      expect(body.items.length).toBeLessThanOrEqual(limit);
      ids.push(...body.items.map((i) => i.id));
      cursor = body.nextCursor;
      if (cursor === null) return ids;
    }
    throw new Error('did not end');
  }

  it('pages a ranked search and a tag page without a repeat or a gap', async () => {
    const s = await scene();
    await many(s, 11);
    const http = await start();
    const ranked = await walk(http, '/v1/search/projects', { q: 'Pager' }, 4);
    expect(new Set(ranked).size).toBe(11);
    const tagged = await walk(http, '/v1/tags/projects', { name: 'pagerterm' }, 3);
    expect(new Set(tagged).size).toBe(11);
    const whole = (
      await http.get('/v1/tags/projects').query({ name: 'PagerTerm', limit: '30' }).expect(200)
    ).body as { items: { id: string }[]; nextCursor: string | null };
    expect(whole.nextCursor).toBeNull();
    expect(tagged).toEqual(whole.items.map((i) => i.id));
  });

  it('does not repeat a row when a matching project is added between pages', async () => {
    const s = await scene();
    await many(s, 6);
    const http = await start();
    const first = (
      await http.get('/v1/search/projects').query({ q: 'Pager', limit: '3' }).expect(200)
    ).body as { items: { id: string }[]; nextCursor: string };
    await createProject(db, s.bob.user, { title: 'Pager newcomer', technologies: ['PagerTerm'] });
    const second = (
      await http
        .get('/v1/search/projects')
        .query({ q: 'Pager', limit: '10', cursor: first.nextCursor })
        .expect(200)
    ).body as { items: { id: string }[] };
    const seen = new Set(first.items.map((i) => i.id));
    for (const i of second.items) expect(seen.has(i.id)).toBe(false);
  });

  it('rejects another list’s cursor, a malformed one and an out-of-range one', async () => {
    const s = await scene();
    await many(s, 6);
    const http = await start();
    const people = (await http.get('/v1/search/people').query({ q: 'ML', limit: '1' }).expect(200))
      .body as { nextCursor: string | null };
    const proj = (
      await http.get('/v1/search/projects').query({ q: 'Pager', limit: '2' }).expect(200)
    ).body as { nextCursor: string };
    const tag = (
      await http.get('/v1/tags/projects').query({ name: 'PagerTerm', limit: '2' }).expect(200)
    ).body as { nextCursor: string };
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const bad = [
      proj.nextCursor, // a projects cursor on the people list
      tag.nextCursor, // a time cursor on a ranked list
      'not-a-cursor',
      enc({ r: 9, t: 1, id: 'a', s: 'search-people' }),
      enc({ r: 1, t: -5, id: 'a', s: 'search-people' }),
      enc({ r: 1, t: 1, id: 'a'.repeat(5000), s: 'search-people' }),
    ];
    for (const cursor of bad) {
      const res = await http.get('/v1/search/people').query({ q: 'ML', cursor }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    expect(people.nextCursor).toBeNull();
    const res = await http
      .get('/v1/tags/projects')
      .query({ name: 'PagerTerm', cursor: proj.nextCursor })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('answers a forged cursor of the right shape with rows that are in the listing, never others', async () => {
    const s = await scene();
    const http = await start();
    // "IoT": published, matching rows exist beside private, draft and hidden-owner ones.
    const whole = (await http.get('/v1/search/projects').query({ q: 'IoT' }).expect(200)).body as {
      items: { id: string }[];
    };
    const allowed = new Set(whole.items.map((i) => i.id));
    expect(allowed.size).toBe(3);
    const privateIds = [s.p.priv.id, s.p.draft.id, s.p.hiddenOwner.id, s.p.teamPriv.id];
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    for (const r of [0, 1, 2, 3]) {
      for (const t of [0, 1_700_000_000_000, 253_402_300_799_999]) {
        for (const id of ['', '0', 'zzzz', privateIds[0]!]) {
          if (id === '') continue;
          const res = await http
            .get('/v1/search/projects')
            .query({ q: 'IoT', cursor: enc({ r, t, id, s: 'search-projects' }) })
            .expect(200);
          for (const item of res.body.items as { id: string }[]) {
            expect(allowed.has(item.id)).toBe(true);
            expect(privateIds).not.toContain(item.id);
          }
        }
      }
    }
  });
});

describe('tag pages (X12)', () => {
  it('finds a term in any case, in the site-wide spelling, with counts of public things only', async () => {
    const s = await scene();
    const http = await start();
    for (const name of ['ML', 'ml', 'Ml']) {
      const r = await everyone<{ name: string; projectCount: number; peopleCount: number }>(
        s,
        http,
        '/v1/tags',
        { name },
      );
      // ML Classifier (Bob); not the private project, not the private profile's
      expect(r).toEqual({ name: 'ML', projectCount: 1, peopleCount: 1 });
    }
    const csharp = (await http.get('/v1/tags').query({ name: 'c#' }).expect(200)).body;
    expect(csharp).toEqual({ name: 'C#', projectCount: 1, peopleCount: 1 });
  });

  it('answers 404 alike for an unknown name and one used only privately', async () => {
    const s = await scene();
    const http = await start();
    const unknown = await http.get('/v1/tags').query({ name: 'NobodyUsesThis' }).expect(404);
    const secret = await http.get('/v1/tags').query({ name: 'SecretTool' }).expect(404);
    expect(secret.body).toEqual(unknown.body);
    expect(secret.body.code).toBe('NOT_FOUND');
    // the lists are empty pages, not errors, and equal too
    for (const path of ['/v1/tags/projects', '/v1/tags/people']) {
      const a = await http.get(path).query({ name: 'SecretTool' }).expect(200);
      const b = await http.get(path).query({ name: 'NobodyUsesThis' }).expect(200);
      expect(a.body).toEqual({ items: [], nextCursor: null });
      expect(b.body).toEqual(a.body);
    }
    void s;
  });

  it('lists projects and people for a term, newest first, public only', async () => {
    const s = await scene();
    const http = await start();
    const projects = await everyone<{ items: CardItem[] }>(s, http, '/v1/tags/projects', {
      name: 'iot',
    });
    expect(titles(projects.items)).toEqual(
      ['IoT Garden', 'Խելացի այգի', 'Ёлочная гирлянда'].toSorted(),
    );
    const people = await everyone<{ items: PersonItem[] }>(s, http, '/v1/tags/people', {
      name: 'ML',
    });
    expect(names(people.items)).toEqual(['Alice Smith']);
  });

  it('treats the name as data', async () => {
    await scene();
    const http = await start();
    for (const name of ["'; DROP TABLE terms; --", '%', '\\', 'x'.repeat(255), 'ML OR 1=1']) {
      await http.get('/v1/tags').query({ name }).expect(404);
      await http.get('/v1/tags/projects').query({ name }).expect(200);
    }
    await http
      .get('/v1/tags')
      .query({ name: 'x'.repeat(256) })
      .expect(400);
    await http.get('/v1/tags').query({ name: '' }).expect(400);
    await http.get('/v1/tags').expect(400);
  });
});

describe('statements and signing', () => {
  function countStatements(http: Http) {
    const dbs = app!.get(DbService);
    let n = 0;
    (dbs as unknown as { db: Database }).db = dbs.db.withPlugin({
      transformQuery: (args) => {
        n++;
        return args.node;
      },
      transformResult: (args) => Promise.resolve(args.result),
    });
    return async (path: string, query: Record<string, string>) => {
      n = 0;
      await http.get(path).query(query).expect(200);
      return n;
    };
  }

  it('runs the same number of statements for 1 result as for 25 (no N+1)', async () => {
    const s = await scene();
    const http = await start();
    const count = countStatements(http);
    const routes: [string, Record<string, string>][] = [
      ['/v1/search', { q: 'Bulk' }],
      ['/v1/search/people', { q: 'Bulk' }],
      ['/v1/search/projects', { q: 'Bulk' }],
      ['/v1/tags/projects', { name: 'BulkTerm' }],
      ['/v1/tags/people', { name: 'BulkTerm' }],
      ['/v1/tags', { name: 'BulkTerm' }],
    ];
    const grow = async (n: number, prefix: string) => {
      for (let i = 0; i < n; i++) {
        const u = await who(`Bulk ${prefix} ${i}`);
        await skills(u.user.id, ['BulkTerm', `Extra${i}`, 'Other']);
        await createProject(db, u.user, {
          title: `Bulk ${prefix} ${i}`,
          technologies: ['BulkTerm', `T${i}`],
          tags: ['a', 'b', `c${i}`],
        });
        await addMember((await mkProject(u)).id, s.bob.user.id, 'accepted');
      }
    };
    const mkProject = (u: Person) =>
      createProject(db, u.user, { title: 'Bulk side', technologies: ['BulkTerm'] }).then(
        (r) => r.project,
      );
    await grow(1, 'small');
    const small = [];
    for (const [path, query] of routes) small.push(await count(path, query));
    await grow(24, 'big');
    const big = [];
    for (const [path, query] of routes) big.push(await count(path, query));
    expect(big).toEqual(small);
    // Counted at query compilation (so a union or subquery counts each part): the
    // grouped search is its two lists, 6 + 4. The ceiling is the point, not the number.
    expect(Math.max(...big)).toBeLessThanOrEqual(10);
  });

  it('signs each distinct stored file once and serves the next request from the cache', async () => {
    const s = await scene();
    const storage = new FakeFileStorage(BUCKET);
    const key = `users/${s.bob.user.id}/shared.png`;
    const url = canonicalObjectUrl(BUCKET, key);
    storage.put(key, Buffer.from('x'), 'image/png');
    for (let i = 0; i < 12; i++) {
      await createProject(db, s.bob.user, {
        title: `Signed ${i}`,
        heroImageUrl: url,
        technologies: ['SignedTerm'],
      });
    }
    await db.updateTable('users').set({ avatarUrl: url }).where('id', '=', s.bob.user.id).execute();
    const http = await start({ STORAGE_BUCKET: BUCKET }, storage);
    const res = await http
      .get('/v1/search/projects')
      .query({ q: 'Signed', limit: '12' })
      .expect(200);
    expect(res.body.items).toHaveLength(12);
    for (const item of res.body.items as CardItem[]) {
      expect(item.heroImageUrl).toContain('X-Goog-Signature');
      expect(item.owner.avatarUrl).toContain('X-Goog-Signature');
    }
    expect(storage.signedReads).toEqual([key]); // 24 uses of one URL: one signing
    await http.get('/v1/search/projects').query({ q: 'Signed', limit: '12' }).expect(200);
    expect(storage.signedReads).toEqual([key]);
  });
});

describe('rate limits', () => {
  it('limits each route on its own: the 3rd /search/people is 429 while /search/projects still answers', async () => {
    const http = await start({ RATE_LIMIT_SEARCH: '2', RATE_LIMIT_SEARCH_SHARED: '2' });
    await http.get('/v1/search/people').query({ q: 'ml' }).expect(200);
    await http.get('/v1/search/people').query({ q: 'ml' }).expect(200);
    const res = await http.get('/v1/search/people').query({ q: 'ml' }).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    await http.get('/v1/search/projects').query({ q: 'ml' }).expect(200);
  });

  it('limits tag pages under the browse budget', async () => {
    const http = await start({ RATE_LIMIT_BROWSE: '1', RATE_LIMIT_BROWSE_SHARED: '1' });
    await http.get('/v1/tags/projects').query({ name: 'ml' }).expect(200);
    await http.get('/v1/tags/projects').query({ name: 'ml' }).expect(429);
  });
});

describe('every discovery route is rate limited (X14)', () => {
  it('answers 429 on the second request to each route documented under the discovery tag', async () => {
    const routes = OPERATIONS.filter((o) => o.tag === 'discovery');
    expect(routes.length).toBeGreaterThanOrEqual(6);
    for (const op of routes) {
      const http = await start({
        RATE_LIMIT_SEARCH: '1',
        RATE_LIMIT_SEARCH_SHARED: '1',
        RATE_LIMIT_BROWSE: '1',
        RATE_LIMIT_BROWSE_SHARED: '1',
      });
      const query: Record<string, string> = {};
      for (const key of Object.keys(op.query?.shape ?? {})) {
        if (key === 'q') query.q = 'ml';
        if (key === 'name') query.name = 'ml';
      }
      const path = op.path.replace(/\{[^}]+\}/g, 'x');
      await http.get(path).query(query);
      const second = await http.get(path).query(query);
      expect(second.status, `${op.method} ${op.path}`).toBe(429);
      await app?.close();
      app = undefined;
    }
  });
});
