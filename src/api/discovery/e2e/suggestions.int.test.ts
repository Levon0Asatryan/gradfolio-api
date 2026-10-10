import type { NestExpressApplication } from '@nestjs/platform-express';
import { CompiledQuery } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../core/db/database.js';
import { DbService } from '../../../core/db/db.service.js';
import { setUserSkills } from '../../../core/db/terms.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { canonicalObjectUrl } from '../../../core/storage/file-rules.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig } from '../../../testing/database.js';
import { createProject } from '../../../testing/factories.js';
import { FakeFileStorage } from '../../../testing/fake-storage.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { addMember, db, person, type Person } from '../../../testing/team.js';

/**
 * GET /v1/search/suggestions against MySQL 8.4: the privacy matrix for a
 * typeahead (it must not reveal a term or a name that search would not), prefix
 * and word-start matching in Latin, Cyrillic and Armenian, hostile text, a
 * fixed statement count, signing once, and its own rate budget.
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
      RATE_LIMIT_DEFAULT: '10000',
      RATE_LIMIT_DEFAULT_SHARED: '10000',
      RATE_LIMIT_SUGGEST: '10000',
      RATE_LIMIT_SUGGEST_SHARED: '10000',
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

interface Sugg {
  query: string;
  people: { id: string; label: string; avatarUrl: string | null }[];
  projects: { id: string; label: string; avatarUrl: string | null }[];
  tags: string[];
}

async function scene() {
  const alice = await who('Alice Smith');
  const alina = await who('Alina Brown');
  const bob = await who('Bob Allen');
  const hidden = await who('Alex Hidden', { isPublic: false });
  const viewer = await who('Viewer V');
  const alena = await who('Алёна Иванова');
  const armen = await who('Արմեն Ասատրյան');
  await skills(alice.user.id, ['Algorithms', 'ML']);
  await skills(bob.user.id, ['Angular']);
  await skills(hidden.user.id, ['AlexOnly', 'Algebra']);
  await skills(alena.user.id, ['Анализ данных']);
  const mk = (owner: Person, title: string, o: Parameters<typeof createProject>[2] = {}) =>
    createProject(db, owner.user, { title, ...o }).then((r) => r.project);
  const p = {
    pub: await mk(alice, 'Alpha Garden', { technologies: ['Arduino'], tags: ['alpine'] }),
    priv: await mk(alice, 'Alpha Secret', { isPublic: false, technologies: ['AlphaSecretTool'] }),
    draft: await mk(alice, 'Alpha Draft', { isDraft: true, technologies: ['AlphaDraftTool'] }),
    ofHidden: await mk(hidden, 'Alpha Hidden', { technologies: ['AlphaHiddenTool'] }),
    pendingOnly: await mk(bob, 'Beta', { isPublic: false, technologies: ['AlphaPrivateOnly'] }),
    elka: await mk(alena, 'Ёлочная гирлянда'),
    am: await mk(armen, 'Խելացի այգի', { technologies: ['Արդուինո'] }),
    word: await mk(bob, 'The Alpha Wave'),
  };
  await addMember(p.priv.id, bob.user.id, 'accepted');
  await addMember(p.pub.id, viewer.user.id, 'pending');
  return { alice, alina, bob, hidden, viewer, alena, armen, p };
}
type Scene = Awaited<ReturnType<typeof scene>>;

const viewersOf = (s: Scene) =>
  [
    ['anonymous', {} as Record<string, string>],
    ['another user', s.viewer.auth as Record<string, string>],
    ['the owner', s.alice.auth as Record<string, string>],
  ] as const;

async function everyone(s: Scene, http: Http, q: string) {
  const bodies: Sugg[] = [];
  for (const [, headers] of viewersOf(s)) {
    bodies.push(
      (await http.get('/v1/search/suggestions').query({ q }).set(headers).expect(200)).body,
    );
  }
  for (const b of bodies) expect(b).toEqual(bodies[0]);
  return bodies[0]!;
}
const labels = (xs: { label: string }[]) => xs.map((x) => x.label);

describe('GET /v1/search/suggestions: visibility (X1-X4 for a typeahead)', () => {
  it('suggests only public people, published projects of public people and terms in public use, the same for everyone', async () => {
    const s = await scene();
    const http = await start();
    const r = await everyone(s, http, 'al');
    // all start with "Al" or have a word that does; ties in rank break on newest, which
    // is not fixed inside one second: compare as a set
    expect(labels(r.people).toSorted()).toEqual(['Alice Smith', 'Alina Brown', 'Bob Allen']);
    expect(labels(r.projects).toSorted()).toEqual(['Alpha Garden', 'The Alpha Wave']);
    // Algorithms (Alice, public), Angular (Bob), alpine (public project tag); not AlexOnly or
    // Algebra (a private profile's), not AlphaSecretTool / AlphaDraftTool / AlphaHiddenTool /
    // AlphaPrivateOnly (private, draft, private owner, private)
    expect(r.tags.toSorted()).toEqual(['Algorithms', 'alpine'].toSorted());
    const text = JSON.stringify(r);
    for (const leak of [
      'Hidden',
      'Secret',
      'Draft',
      'AlexOnly',
      'Algebra',
      'PrivateOnly',
      'Alex',
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it('does not let the box probe for a private term, name or title: it answers as it does for nothing', async () => {
    const s = await scene();
    const http = await start();
    for (const q of [
      'AlphaSecret',
      'AlexOnly',
      'Alex H',
      'Alpha Secret',
      'Alpha Draft',
      'Algebra',
    ]) {
      const r = await everyone(s, http, q);
      expect(r.tags, q).toEqual([]);
      expect(r.people, q).toEqual([]);
      expect(r.projects, q).toEqual([]);
    }
  });

  it('follows a privacy switch at once', async () => {
    const s = await scene();
    const http = await start();
    expect(labels((await everyone(s, http, 'Alice')).people)).toEqual(['Alice Smith']);
    await db
      .updateTable('users')
      .set({ isPublic: false })
      .where('id', '=', s.alice.user.id)
      .execute();
    const r = await everyone(s, http, 'Al');
    expect(labels(r.people)).not.toContain('Alice Smith');
    expect(labels(r.projects)).not.toContain('Alpha Garden'); // her work leaves with her profile
    expect(r.tags).not.toContain('Algorithms');
  });

  it('has exactly the documented keys and no private field', async () => {
    const s = await scene();
    const http = await start();
    const r = await everyone(s, http, 'al');
    expect(Object.keys(r).toSorted()).toEqual(['people', 'projects', 'query', 'tags']);
    expect(Object.keys(r.people[0]!).toSorted()).toEqual(['avatarUrl', 'id', 'label']);
    expect(Object.keys(r.projects[0]!).toSorted()).toEqual(['avatarUrl', 'id', 'label']);
    const text = JSON.stringify(r);
    for (const k of ['email', 'headline', 'auth0', 'birthday', 'phone', 'isPublic']) {
      expect(text).not.toContain(k);
    }
  });
});

describe('matching', () => {
  it('matches the start of the text or of a word in it, best first, at most 5 each', async () => {
    const s = await scene();
    for (let i = 0; i < 8; i++) await who(`Al Extra ${i}`);
    const http = await start();
    const r = await everyone(s, http, 'al');
    expect(r.people).toHaveLength(5);
    // names that start with "al" come before the one that has it in a later word
    const starts = r.people.map((p) => p.label.toLowerCase().startsWith('al'));
    expect(starts).toEqual([...starts].sort((a, b) => Number(b) - Number(a)));
    const word = await everyone(s, http, 'Wave');
    expect(labels(word.projects)).toEqual(['The Alpha Wave']);
    const mid = await everyone(s, http, 'alpha w');
    expect(labels(mid.projects)).toEqual(['The Alpha Wave']);
  });

  it('puts an exact name or term first', async () => {
    const s = await scene();
    await createProject(db, s.bob.user, { title: 'Alpha', technologies: ['Alpha'] });
    const http = await start();
    const r = await everyone(s, http, 'alpha');
    expect(r.projects[0]!.label).toBe('Alpha');
    expect(r.tags[0]).toBe('Alpha');
  });

  it('works for a single letter, and treats stopwords as ordinary text', async () => {
    const s = await scene();
    const http = await start();
    expect(labels((await everyone(s, http, 'a')).people).length).toBeGreaterThan(0);
    expect(labels((await everyone(s, http, 'the')).projects)).toEqual(['The Alpha Wave']);
  });

  it('handles case, ё/е and Armenian in any case', async () => {
    const s = await scene();
    const http = await start();
    for (const q of ['Алёна', 'алена', 'АЛЕ', 'але']) {
      expect(labels((await everyone(s, http, q)).people), q).toEqual(['Алёна Иванова']);
    }
    for (const q of ['Ёлоч', 'елоч', 'ЕЛОЧ']) {
      expect(labels((await everyone(s, http, q)).projects), q).toEqual(['Ёлочная гирлянда']);
    }
    for (const q of ['Արմ', 'ԱՐՄ', 'արմ']) {
      expect(labels((await everyone(s, http, q)).people), q).toEqual(['Արմեն Ասատրյան']);
    }
    expect((await everyone(s, http, 'Խել')).projects).toHaveLength(1);
    expect((await everyone(s, http, 'ԱՐԴ')).tags).toEqual(['Արդուինո']);
    expect((await everyone(s, http, 'анали')).tags).toEqual(['Анализ данных']);
    // case-insensitive terms
    expect((await everyone(s, http, 'ML')).tags).toEqual(['ML']);
    expect((await everyone(s, http, 'ml')).tags).toEqual(['ML']);
  });

  it('takes % and _ as text', async () => {
    const s = await scene();
    await createProject(db, s.bob.user, { title: '100% Pure' });
    const http = await start();
    expect(labels((await everyone(s, http, '100%')).projects)).toEqual(['100% Pure']);
    for (const q of ['%', '_', '1%', '\\']) {
      expect((await everyone(s, http, q)).projects, q).toEqual([]);
    }
  });
});

describe('input limits', () => {
  it.each([
    ['no q', {}],
    ['a blank q', { q: '   ' }],
    ['51 characters', { q: 'a'.repeat(51) }],
    ['an unknown key', { q: 'a', limit: '3' }],
    ['q twice', { q: ['a', 'b'] }],
  ])('answers 400 VALIDATION_FAILED for %s', async (_n, query) => {
    const http = await start();
    const res = await http.get('/v1/search/suggestions').query(query).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it.each(['+(', '"x', '@3', '*', "'; DROP TABLE users; --", 'a\u0000b', '😀', 'x'.repeat(50)])(
    'answers 200 for %j',
    async (q) => {
      await scene();
      const http = await start();
      const res = await http.get('/v1/search/suggestions').query({ q }).expect(200);
      expect(res.body.people.length).toBeLessThanOrEqual(5);
    },
  );

  it('accepts exactly 50 characters (counted as characters, not bytes)', async () => {
    const http = await start();
    await http
      .get('/v1/search/suggestions')
      .query({ q: 'Ա'.repeat(50) })
      .expect(200);
    await http
      .get('/v1/search/suggestions')
      .query({ q: 'Ա'.repeat(51) })
      .expect(400);
  });

  it('answers 401 for a bad token and serves a good one', async () => {
    const s = await scene();
    const http = await start();
    await http
      .get('/v1/search/suggestions')
      .query({ q: 'a' })
      .set('Authorization', 'Bearer x')
      .expect(401);
    await http.get('/v1/search/suggestions').query({ q: 'a' }).set(s.viewer.auth).expect(200);
  });
});

describe('statements, signing and the rate budget', () => {
  it('runs three statements whatever the number of matches (no N+1)', async () => {
    const s = await scene();
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
    const count = async () => {
      n = 0;
      await http.get('/v1/search/suggestions').query({ q: 'bulk' }).expect(200);
      return n;
    };
    const none = await count();
    for (let i = 0; i < 20; i++) {
      const u = await who(`Bulk ${i}`);
      await skills(u.user.id, [`Bulk${i}`]);
      await createProject(db, u.user, { title: `Bulk project ${i}`, technologies: [`BulkT${i}`] });
    }
    const many = await count();
    expect(many).toBe(none);
    expect(many).toBe(3);
    void s;
  });

  it('signs a shared avatar once', async () => {
    const s = await scene();
    const storage = new FakeFileStorage(BUCKET);
    const key = `users/${s.alice.user.id}/a.png`;
    storage.put(key, Buffer.from('x'), 'image/png');
    const url = canonicalObjectUrl(BUCKET, key);
    await db
      .updateTable('users')
      .set({ avatarUrl: url })
      .where('id', '=', s.alice.user.id)
      .execute();
    await db
      .updateTable('users')
      .set({ avatarUrl: url })
      .where('id', '=', s.alina.user.id)
      .execute();
    const http = await start({ STORAGE_BUCKET: BUCKET }, storage);
    const r = (await http.get('/v1/search/suggestions').query({ q: 'Al' }).expect(200))
      .body as Sugg;
    expect(r.people.filter((p) => p.avatarUrl?.includes('X-Goog-Signature'))).toHaveLength(2);
    expect(storage.signedReads).toEqual([key]);
  });

  it('has its own budget: typeahead bursts do not spend search, and the 4th with a budget of 3 is 429', async () => {
    const http = await start({ RATE_LIMIT_SUGGEST: '3', RATE_LIMIT_SUGGEST_SHARED: '3' });
    for (let i = 0; i < 3; i++)
      await http.get('/v1/search/suggestions').query({ q: 'a' }).expect(200);
    const res = await http.get('/v1/search/suggestions').query({ q: 'a' }).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    await http.get('/v1/search').query({ q: 'ml' }).expect(200); // search is untouched
  });
});

describe('the prefix on the term registry is a range scan', () => {
  it('reads terms through the primary key for a prefix', async () => {
    await scene();
    const res = await db.executeQuery<Record<string, unknown>>(
      CompiledQuery.raw(
        "EXPLAIN FORMAT=TREE SELECT name FROM terms WHERE name LIKE 'al%' ORDER BY name LIMIT 5",
      ),
    );
    expect(String(Object.values(res.rows[0]!)[0])).toMatch(/PRIMARY|range|covering/i);
  });
});
