import type { NestExpressApplication } from '@nestjs/platform-express';
import { CompiledQuery, sql } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../core/db/database.js';
import { DbService } from '../../../core/db/db.service.js';
import { newId } from '../../../core/db/ids.js';
import { setUserSkills } from '../../../core/db/terms.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { perfSeed } from '../../../core/db/seed/perf-seed.js';
import { canonicalObjectUrl } from '../../../core/storage/file-rules.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig } from '../../../testing/database.js';
import { createProject } from '../../../testing/factories.js';
import { FakeFileStorage } from '../../../testing/fake-storage.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { addMember, db, person, type Person } from '../../../testing/team.js';
import { browseProjectsQuery, browseUsersQuery } from '../repositories/browse.repository.js';

/**
 * M6 PR (b): browse (projects, people, facets) and the tag cloud against MySQL
 * 8.4: the privacy matrix for every route (X1-X4), sort and filters, paging,
 * the index each statement uses (docs/m6-plan.md §6), the cache's staleness and
 * fixed statement counts.
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
  vi.useRealTimers();
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
      RATE_LIMIT_SEARCH: '10000',
      RATE_LIMIT_SEARCH_SHARED: '10000',
      RATE_LIMIT_BROWSE: '10000',
      RATE_LIMIT_BROWSE_SHARED: '10000',
      // Uncached unless a test asks: a stale cloud would hide a missing predicate.
      DISCOVERY_CACHE_S: '0',
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
const education = (
  userId: string,
  e: { institution: string; field: string; endYear: number | null },
) =>
  db
    .insertInto('education')
    .values({ id: newId(), userId, degree: 'B.Sc.', startYear: 2020, ...e })
    .execute();

interface Card {
  id: string;
  title: string;
  category: string;
  status: string;
  owner: { id: string; name: string };
}
interface PersonItem {
  id: string;
  name: string;
  projectCount: number;
}
const titles = (xs: { title: string }[]) => xs.map((x) => x.title);
const names = (xs: { name: string }[]) => xs.map((x) => x.name);
const at = (day: number) => new Date(Date.UTC(2026, 0, day, 12));

async function scene() {
  const alice = await who('Alice A', { createdAt: at(1) });
  const bob = await who('Bob B', { createdAt: at(2) });
  const hidden = await who('Hidden H', { isPublic: false, createdAt: at(3) });
  const viewer = await who('Viewer V', { createdAt: at(4) });
  const mk = (owner: Person, title: string, o: Parameters<typeof createProject>[2] = {}) =>
    createProject(db, owner.user, { title, ...o }).then((r) => r.project);
  const p = {
    old: await mk(alice, 'Oldest', { createdAt: at(1), updatedAt: at(20), category: 'academic' }),
    mid: await mk(bob, 'Middle', { createdAt: at(2), updatedAt: at(10), category: 'research' }),
    new: await mk(alice, 'Newest', {
      createdAt: at(3),
      updatedAt: at(5),
      category: 'research',
      status: 'completed',
    }),
    priv: await mk(alice, 'Private One', { isPublic: false, createdAt: at(9), updatedAt: at(9) }),
    draft: await mk(alice, 'Draft One', { isDraft: true, createdAt: at(9), updatedAt: at(9) }),
    ofHidden: await mk(hidden, 'Of Hidden', { createdAt: at(9), updatedAt: at(9) }),
    teamPriv: await mk(alice, 'Team Private', {
      isPublic: false,
      createdAt: at(9),
      updatedAt: at(9),
    }),
  };
  await addMember(p.teamPriv.id, bob.user.id, 'accepted');
  await addMember(p.new.id, viewer.user.id, 'pending');
  await skills(alice.user.id, ['ML', 'Go']);
  await skills(bob.user.id, ['ML']);
  await skills(hidden.user.id, ['ML', 'SecretTool']);
  await education(alice.user.id, { institution: 'NPUA', field: 'Computer Science', endYear: 2026 });
  await education(bob.user.id, { institution: 'npua', field: 'Design', endYear: 2027 });
  await education(bob.user.id, { institution: 'YSU', field: 'Computer Science', endYear: 2025 });
  await education(hidden.user.id, { institution: 'NPUA', field: 'Secret Major', endYear: 2026 });
  return { alice, bob, hidden, viewer, p };
}
type Scene = Awaited<ReturnType<typeof scene>>;

const viewersOf = (s: Scene) =>
  [
    ['anonymous', {} as Record<string, string>],
    ['another user', s.viewer.auth as Record<string, string>],
    ['the owner', s.alice.auth as Record<string, string>],
  ] as const;

/** One body for anonymous, another user and the owner: discovery ignores the viewer (N1). */
async function everyone<T>(s: Scene, http: Http, path: string, query: Record<string, string> = {}) {
  const bodies: T[] = [];
  for (const [, headers] of viewersOf(s)) {
    bodies.push((await http.get(path).query(query).set(headers).expect(200)).body as T);
  }
  // `generatedAt` is when a cached value was computed; with the cache off it is the call's time.
  const same = (b: T) => ({ ...(b as object), generatedAt: undefined });
  for (const b of bodies) expect(same(b)).toEqual(same(bodies[0]!));
  return bodies[0]!;
}

describe('GET /v1/projects (browse): visibility, sort, filters', () => {
  it('lists published projects of public profiles only, the same for everyone', async () => {
    const s = await scene();
    const http = await start();
    const r = await everyone<{ items: Card[] }>(s, http, '/v1/projects');
    expect(titles(r.items)).toEqual(['Newest', 'Middle', 'Oldest']);
    const text = JSON.stringify(r);
    for (const leak of ['Private', 'Draft', 'Hidden', 'Team Private', 'SecretTool']) {
      expect(text).not.toContain(leak);
    }
  });

  it('orders by creation or by last change, newest first, and accepts sort=newest explicitly', async () => {
    const s = await scene();
    const http = await start();
    const newest = await everyone<{ items: Card[] }>(s, http, '/v1/projects', { sort: 'newest' });
    expect(titles(newest.items)).toEqual(['Newest', 'Middle', 'Oldest']);
    const updated = await everyone<{ items: Card[] }>(s, http, '/v1/projects', { sort: 'updated' });
    expect(titles(updated.items)).toEqual(['Oldest', 'Middle', 'Newest']);
  });

  it('filters by category and status, and both together', async () => {
    const s = await scene();
    const http = await start();
    const research = await everyone<{ items: Card[] }>(s, http, '/v1/projects', {
      category: 'research',
    });
    expect(titles(research.items)).toEqual(['Newest', 'Middle']);
    const done = await everyone<{ items: Card[] }>(s, http, '/v1/projects', {
      category: 'research',
      status: 'completed',
    });
    expect(titles(done.items)).toEqual(['Newest']);
    const none = await everyone<{ items: Card[] }>(s, http, '/v1/projects', {
      category: 'hackathon',
    });
    expect(none.items).toEqual([]);
  });

  it('drops a project from the gallery the moment its owner goes private, and brings it back', async () => {
    const s = await scene();
    const http = await start();
    await db
      .updateTable('users')
      .set({ isPublic: false })
      .where('id', '=', s.bob.user.id)
      .execute();
    expect(titles((await http.get('/v1/projects').expect(200)).body.items)).toEqual([
      'Newest',
      'Oldest',
    ]);
    await db.updateTable('users').set({ isPublic: true }).where('id', '=', s.bob.user.id).execute();
    expect((await http.get('/v1/projects').expect(200)).body.items).toHaveLength(3);
  });

  it.each([
    ['an unknown key', { tag: 'ml' }],
    ['an unknown sort', { sort: 'oldest' }],
    ['a name sort', { sort: 'name_asc' }],
    ['an unknown category', { category: 'nope' }],
    ['a limit over the maximum', { limit: '31' }],
    ['a limit of zero', { limit: '0' }],
    ['a cursor of another list', { cursor: 'x' }],
  ])('answers 400 for %s', async (_n, query) => {
    const http = await start();
    const res = await http.get('/v1/projects').query(query).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('keeps POST /v1/projects and GET /v1/projects/:id where they were', async () => {
    const s = await scene();
    const http = await start();
    await http.post('/v1/projects').expect(401); // still needs a token
    await http.get(`/v1/projects/${s.p.new.id}`).expect(200);
    await http.get('/v1/projects/cloud').expect(404);
  });
});

describe('paging (browse and the directory)', () => {
  async function many(s: Scene, n: number) {
    for (let i = 0; i < n; i++) {
      await createProject(db, s.bob.user, {
        title: `Page ${i}`,
        // pairs share a timestamp, so the id must break the tie
        createdAt: new Date(Date.UTC(2026, 2, 1, 0, Math.floor(i / 2))),
        updatedAt: new Date(Date.UTC(2026, 3, 1, 0, Math.floor((n - i) / 3))),
      });
    }
  }
  async function walk(http: Http, path: string, query: Record<string, string>, limit: number) {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 60; guard++) {
      const body = (
        await http
          .get(path)
          .query({ ...query, limit: String(limit), ...(cursor ? { cursor } : {}) })
          .expect(200)
      ).body as { items: { id: string }[]; nextCursor: string | null };
      expect(body.items.length).toBeLessThanOrEqual(limit);
      ids.push(...body.items.map((i) => i.id));
      cursor = body.nextCursor;
      if (cursor === null) return ids;
    }
    throw new Error('did not end');
  }

  it('walks every sort without a repeat or a gap, and matches the unpaged order', async () => {
    const s = await scene();
    await many(s, 13);
    const http = await start();
    for (const sort of ['newest', 'updated']) {
      const walked = await walk(http, '/v1/projects', { sort }, 4);
      expect(new Set(walked).size).toBe(walked.length);
      expect(walked).toHaveLength(16); // 3 scene projects + 13
      const all = (await http.get('/v1/projects').query({ sort, limit: '30' }).expect(200))
        .body as { items: { id: string }[]; nextCursor: null };
      expect(walked).toEqual(all.items.map((i) => i.id));
    }
    const users = await walk(http, '/v1/users', {}, 1);
    expect(users).toHaveLength(3); // alice, bob, viewer; not the private profile
  });

  it('rejects another list’s cursor, and answers a forged one with rows of the listing only', async () => {
    const s = await scene();
    await many(s, 6);
    const http = await start();
    const first = (await http.get('/v1/projects').query({ limit: '2' }).expect(200)).body as {
      nextCursor: string;
    };
    const updated = (
      await http.get('/v1/projects').query({ limit: '2', sort: 'updated' }).expect(200)
    ).body as { nextCursor: string };
    await http.get('/v1/projects').query({ sort: 'updated', cursor: first.nextCursor }).expect(400);
    await http
      .get('/v1/projects')
      .query({ sort: 'newest', cursor: updated.nextCursor })
      .expect(400);
    await http.get('/v1/users').query({ cursor: first.nextCursor }).expect(400);

    const whole = (await http.get('/v1/projects').query({ limit: '30' }).expect(200)).body as {
      items: { id: string }[];
    };
    const allowed = new Set(whole.items.map((i) => i.id));
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    for (const t of [0, 1_800_000_000_000, 253_402_300_799_999]) {
      for (const id of ['0', 'zzzz', s.p.priv.id, s.p.draft.id, s.p.ofHidden.id]) {
        const res = await http
          .get('/v1/projects')
          .query({ cursor: enc({ t, id, s: 'browse-projects:newest' }) })
          .expect(200);
        for (const item of res.body.items as { id: string }[]) {
          expect(allowed.has(item.id)).toBe(true);
        }
      }
    }
  });
});

describe('GET /v1/users (directory) and /v1/users/facets', () => {
  it('lists public people newest first, the same for everyone, never a private profile', async () => {
    const s = await scene();
    const http = await start();
    const r = await everyone<{ items: PersonItem[] }>(s, http, '/v1/users', { sort: 'newest' });
    expect(names(r.items)).toEqual(['Viewer V', 'Bob B', 'Alice A']);
    expect(JSON.stringify(r)).not.toContain('Hidden');
    const bob = r.items.find((x) => x.name === 'Bob B')!;
    // Middle (own) + Newest... no: Bob owns Middle; he is an accepted member of Team Private (private)
    expect(bob.projectCount).toBe(1);
  });

  it('filters by school (any case), major and graduation year; one entry must match all of them', async () => {
    const s = await scene();
    const http = await start();
    const by = async (q: Record<string, string>) =>
      names((await everyone<{ items: PersonItem[] }>(s, http, '/v1/users', q)).items);
    expect(await by({ school: 'NPUA' })).toEqual(['Bob B', 'Alice A']);
    expect(await by({ school: 'npua' })).toEqual(['Bob B', 'Alice A']);
    expect(await by({ gradYear: '2026' })).toEqual(['Alice A']);
    expect(await by({ major: 'computer science' })).toEqual(['Bob B', 'Alice A']);
    expect(await by({ school: 'NPUA', major: 'Computer Science' })).toEqual(['Alice A']);
    // Bob has NPUA and has Computer Science, but not in the same entry
    expect(await by({ school: 'NPUA', major: 'Computer Science', gradYear: '2027' })).toEqual([]);
    expect(await by({ school: 'YSU', gradYear: '2025' })).toEqual(['Bob B']);
    expect(await by({ school: 'Nowhere' })).toEqual([]);
    // the private profile's NPUA entry and "Secret Major" never surface
    expect(await by({ major: 'Secret Major' })).toEqual([]);
  });

  it('excludes a person with no education entry as soon as a filter is given', async () => {
    const s = await scene();
    const http = await start();
    const all = await http.get('/v1/users').expect(200);
    expect(names(all.body.items)).toContain('Viewer V');
    const filtered = await http.get('/v1/users').query({ gradYear: '2026' }).expect(200);
    expect(names(filtered.body.items)).not.toContain('Viewer V');
    void s;
  });

  it.each([
    ['an unknown sort', { sort: 'oldest' }],
    ['a year out of range', { gradYear: '1800' }],
    ['a year that is not a number', { gradYear: 'abc' }],
    ['a blank school', { school: '   ' }],
    ['a 201-character school', { school: 'x'.repeat(201) }],
    ['an unknown key', { q: 'ml' }],
  ])('answers 400 for %s', async (_n, query) => {
    const http = await start();
    expect((await http.get('/v1/users').query(query).expect(400)).body.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('serves /users/facets as facets, not as a profile id, and keeps /users/:id a profile', async () => {
    const s = await scene();
    const http = await start();
    const f = await everyone<{
      schools: { value: string; count: number }[];
      majors: { value: string; count: number }[];
      years: { value: number; count: number }[];
    }>(s, http, '/v1/users/facets').then((b) => ({ ...b, generatedAt: undefined }));
    // alice NPUA; bob npua (same choice) and YSU; the private profile's NPUA does not count
    expect(f.schools).toEqual([
      { value: 'NPUA', count: 2 },
      { value: 'YSU', count: 1 },
    ]);
    expect(f.majors).toEqual([
      { value: 'Computer Science', count: 2 },
      { value: 'Design', count: 1 },
    ]);
    expect(f.years).toEqual([
      { value: 2027, count: 1 },
      { value: 2026, count: 1 },
      { value: 2025, count: 1 },
    ]);
    expect(JSON.stringify(f)).not.toContain('Secret');
    await http.get(`/v1/users/${s.alice.user.id}`).expect(200);
    await http.get('/v1/users/facets').query({ x: '1' }).expect(400);
  });

  it('shows one spelling per facet choice, the same whichever row was written first', async () => {
    // `NPUA` and `npua` are one choice under the collation; which one is shown must not
    // depend on insertion order (MIN() under that collation ties and returns the first
    // row it meets). Upper case is the bytewise-first spelling, in every script.
    const spellings = [
      ['NPUA', 'npua'],
      ['Информатика', 'информатика'],
      ['Ծրագրավորում', 'ծրագրավորում'],
    ] as const;
    for (const order of [0, 1] as const) {
      await db.deleteFrom('users').execute();
      const http = await start();
      for (const [upper, lower] of spellings) {
        const first = order === 0 ? upper : lower;
        const second = order === 0 ? lower : upper;
        // the lower-case spelling is the commoner one: this is not "most frequent wins"
        for (const [i, text] of [first, second, lower].entries()) {
          const u = await who(`Facet ${order}-${upper}-${i}`);
          await education(u.user.id, { institution: text, field: text, endYear: 2026 });
        }
      }
      const f = (await http.get('/v1/users/facets').expect(200)).body as {
        schools: { value: string }[];
        majors: { value: string }[];
      };
      expect(f.schools.map((s) => s.value).toSorted()).toEqual(
        spellings.map(([upper]) => upper).toSorted(),
      );
      expect(f.majors.map((s) => s.value).toSorted()).toEqual(
        spellings.map(([upper]) => upper).toSorted(),
      );
      await app?.close();
      app = undefined;
    }
  });

  it('caps each facet list at FACET_MAX', async () => {
    const s = await scene();
    for (let i = 0; i < 5; i++) {
      await education(s.alice.user.id, {
        institution: `School ${i}`,
        field: 'F',
        endYear: 2000 + i,
      });
    }
    const http = await start({ FACET_MAX: '3' });
    const f = (await http.get('/v1/users/facets').expect(200)).body;
    expect(f.schools).toHaveLength(3);
    expect(f.years).toHaveLength(3);
  });
});

describe('GET /v1/tags/cloud', () => {
  it('counts public projects and people once each, most used first, never private work', async () => {
    const s = await scene();
    // one project with the same term as a tag and a technology counts once
    await createProject(db, s.bob.user, {
      title: 'Both',
      technologies: ['Zed'],
      tags: ['zed'],
    });
    await createProject(db, s.alice.user, {
      title: 'Private Zed',
      isPublic: false,
      technologies: ['Zed', 'SecretTool'],
    });
    const http = await start();
    const r = await everyone<{ items: { name: string; projects: number; people: number }[] }>(
      s,
      http,
      '/v1/tags/cloud',
    ).then((b) => ({ ...b, generatedAt: undefined }));
    const by = Object.fromEntries(r.items.map((i) => [i.name, i]));
    expect(by.Zed).toEqual({ name: 'Zed', projects: 1, people: 0 });
    expect(by.ML).toEqual({ name: 'ML', projects: 0, people: 2 }); // alice, bob; not the private profile
    expect(by.SecretTool).toBeUndefined();
    const order = r.items.map((i) => i.projects + i.people);
    expect(order).toEqual(order.toSorted((a, b) => b - a));
  });

  it('honours limit and its maximum', async () => {
    await scene();
    const http = await start({ TAG_CLOUD_MAX: '5', TAG_CLOUD_SIZE: '2' });
    expect((await http.get('/v1/tags/cloud').expect(200)).body.items).toHaveLength(2);
    expect(
      (await http.get('/v1/tags/cloud').query({ limit: '1' }).expect(200)).body.items,
    ).toHaveLength(1);
    await http.get('/v1/tags/cloud').query({ limit: '6' }).expect(400);
    await http.get('/v1/tags/cloud').query({ limit: '0' }).expect(400);
    await http.get('/v1/tags/cloud').query({ other: '1' }).expect(400);
  });

  it('is served from memory for the cache time, stale by at most that, and then fresh', async () => {
    const s = await scene();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    const http = await start({ DISCOVERY_CACHE_S: '60' });
    const first = (await http.get('/v1/tags/cloud').expect(200)).body as {
      items: { name: string }[];
      generatedAt: string;
    };
    expect(first.generatedAt).toBe('2026-06-01T00:00:00.000Z');
    await createProject(db, s.bob.user, { title: 'Fresh', technologies: ['Brandnew'] });

    vi.setSystemTime(new Date('2026-06-01T00:00:59Z'));
    const stale = (await http.get('/v1/tags/cloud').expect(200)).body as typeof first;
    expect(stale).toEqual(first);
    expect(stale.items.map((i) => i.name)).not.toContain('Brandnew');

    vi.setSystemTime(new Date('2026-06-01T00:01:01Z'));
    const fresh = (await http.get('/v1/tags/cloud').expect(200)).body as typeof first;
    expect(fresh.items.map((i) => i.name)).toContain('Brandnew');
    expect(fresh.generatedAt).toBe('2026-06-01T00:01:01.000Z');
  });
});

describe('statements, signing and limits', () => {
  it('runs the same number of statements for 1 result as for 25 (no N+1)', async () => {
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
    const routes: [string, Record<string, string>][] = [
      ['/v1/projects', { limit: '30' }],
      ['/v1/projects', { limit: '30', sort: 'updated', category: 'research' }],
      ['/v1/users', { limit: '30' }],
      ['/v1/users', { limit: '30', school: 'NPUA', gradYear: '2026' }],
    ];
    const count = async () => {
      const out: number[] = [];
      for (const [path, query] of routes) {
        n = 0;
        await http.get(path).query(query).expect(200);
        out.push(n);
      }
      return out;
    };
    const small = await count();
    for (let i = 0; i < 25; i++) {
      const u = await who(`Bulk ${i}`);
      await skills(u.user.id, ['ML', `S${i}`]);
      await education(u.user.id, { institution: 'NPUA', field: 'CS', endYear: 2026 });
      const p = await createProject(db, u.user, {
        title: `Bulk ${i}`,
        category: 'research',
        technologies: ['ML', `T${i}`],
        tags: ['a', `b${i}`],
      });
      await addMember(p.project.id, s.alice.user.id, 'accepted');
    }
    const big = await count();
    expect(big).toEqual(small);
    expect(Math.max(...big)).toBeLessThanOrEqual(8);
  });

  it('signs each distinct stored file once for a page of 20 cards', async () => {
    const s = await scene();
    const storage = new FakeFileStorage(BUCKET);
    const key = `users/${s.bob.user.id}/shared.png`;
    storage.put(key, Buffer.from('x'), 'image/png');
    const url = canonicalObjectUrl(BUCKET, key);
    for (let i = 0; i < 20; i++) {
      await createProject(db, s.bob.user, { title: `Img ${i}`, heroImageUrl: url });
    }
    await db.updateTable('users').set({ avatarUrl: url }).where('id', '=', s.bob.user.id).execute();
    const http = await start({ STORAGE_BUCKET: BUCKET }, storage);
    const res = await http.get('/v1/projects').query({ limit: '30' }).expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(20);
    expect(storage.signedReads).toEqual([key]);
    const people = await http.get('/v1/users').expect(200);
    expect(people.body.items.length).toBeGreaterThan(0);
    expect(storage.signedReads).toEqual([key]); // the avatar url is the same key: cached
  });

  it('limits each browse route on its own budget', async () => {
    const http = await start({ RATE_LIMIT_BROWSE: '2', RATE_LIMIT_BROWSE_SHARED: '2' });
    await http.get('/v1/projects').expect(200);
    await http.get('/v1/projects').expect(200);
    expect((await http.get('/v1/projects').expect(429)).body.code).toBe('RATE_LIMITED');
    await http.get('/v1/users').expect(200); // its own counter
    await http.get('/v1/tags/cloud').expect(200);
    await http.get('/v1/users/facets').expect(200);
  });

  it('answers 401 for a bad token and serves a good one', async () => {
    const s = await scene();
    const http = await start();
    await http.get('/v1/projects').set('Authorization', 'Bearer junk').expect(401);
    await http.get('/v1/users').set(s.viewer.auth).expect(200);
  });
});

describe('the indexes of migration 0007 serve each sort and filter (plan §6)', () => {
  async function explain(q: { compile: () => { sql: string; parameters: readonly unknown[] } }) {
    const c = q.compile();
    const res = await db.executeQuery<Record<string, unknown>>(
      CompiledQuery.raw(`EXPLAIN FORMAT=TREE ${c.sql}`, [...c.parameters]),
    );
    return String(Object.values(res.rows[0]!)[0]);
  }

  it('reads published projects from an index in order, with no filesort, whatever the sort or category', async () => {
    // The plan's size (1,000 users, 3,000 projects): the optimizer's choice between an
    // index and a scan depends on the table, and a handful of rows would not show it.
    await perfSeed(db);
    for (const t of ['projects', 'users', 'education']) {
      await sql`ANALYZE TABLE ${sql.table(t)}`.execute(db);
    }
    const cases: [string, ReturnType<typeof browseProjectsQuery>, RegExp][] = [
      [
        'newest',
        browseProjectsQuery(db, { sort: 'newest' }, undefined, 12),
        /idx_projects_browse /,
      ],
      [
        'newest + category',
        browseProjectsQuery(db, { sort: 'newest', category: 'research' }, undefined, 12),
        /idx_projects_browse_category/,
      ],
      [
        'updated',
        browseProjectsQuery(db, { sort: 'updated' }, undefined, 12),
        /idx_projects_browse_updated/,
      ],
      [
        'newest after a cursor',
        browseProjectsQuery(db, { sort: 'newest' }, { t: Date.now(), id: 'z' }, 12),
        /idx_projects_browse /,
      ],
    ];
    for (const [name, q, index] of cases) {
      const plan = await explain(q);
      expect(plan, name).toMatch(index);
      expect(plan, name).not.toMatch(/Sort:|filesort/i);
    }
  });

  it('reads public users from an index in order, and the education filters from theirs', async () => {
    await perfSeed(db);
    for (const t of ['users', 'education']) await sql`ANALYZE TABLE ${sql.table(t)}`.execute(db);
    const plain = await explain(browseUsersQuery(db, {}, undefined, 12));
    expect(plain, plain).toMatch(/idx_users_browse/);
    const school = await explain(
      browseUsersQuery(db, { school: 'NPUA', gradYear: 2026 }, undefined, 12),
    );
    expect(school).toMatch(/idx_education_institution/);
    const year = await explain(browseUsersQuery(db, { gradYear: 2026 }, undefined, 12));
    expect(year).toMatch(/idx_education_end_year/);
    const major = await explain(browseUsersQuery(db, { major: 'Design' }, undefined, 12));
    expect(major).toMatch(/idx_education_field/);
  });
});
