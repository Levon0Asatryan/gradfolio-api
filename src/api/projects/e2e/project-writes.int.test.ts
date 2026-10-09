import type { NestExpressApplication } from '@nestjs/platform-express';
import { createConnection, type Connection } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { sanitizeDescription } from '../../../core/validation/html.js';
import { CORPUS } from '../../../core/validation/html.corpus.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testConfig, testDatabase, testDatabaseUrl } from '../../../testing/database.js';
import { createProject, createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/**
 * M4 PR (b) through the whole stack against MySQL 8.4: create / patch / delete
 * of projects, the sanitizer on every path that writes `description_html`,
 * ownership, and the races. Every race is forced with a lock held on a second
 * connection and `waitForLockWaiters`, never a sleep.
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();
const db = testDatabase();

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

async function member(label: string) {
  const sub = `auth0|${label}-${newId()}`;
  const user = await createUser(db, { auth0Id: sub, name: label });
  return { user, auth: { Authorization: `Bearer ${await tenant.sign({ sub })}` } };
}

const rowOf = (id: string) =>
  db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
const tagsOf = async (id: string) =>
  (
    await db
      .selectFrom('projectTags')
      .select('name')
      .where('projectId', '=', id)
      .orderBy('sortOrder')
      .execute()
  ).map((r) => r.name);
const countProjects = async (userId: string) =>
  Number(
    (
      await db
        .selectFrom('projects')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('userId', '=', userId)
        .executeTakeFirstOrThrow()
    ).n,
  );

const FULL = {
  title: '  Smart Garden  ',
  summary: 'Waters plants',
  descriptionHtml: '<h2>Why</h2><p>Because <strong>plants</strong>.</p>',
  category: 'research',
  status: 'completed',
  isPublic: true,
  isDraft: false,
  liveDemoUrl: 'https://demo.example/',
  repoUrl: 'https://github.com/x/y',
  heroImageUrl: 'https://img.example/h.png',
  metadata: {
    startDate: '2025-01-15',
    endDate: '2025-06-01',
    course: 'IoT 101',
    professor: 'Dr. H',
  },
  technologies: ['Arduino', 'python', 'PYTHON'],
  tags: ['iot', 'Garden'],
  links: [{ label: 'Docs', url: 'https://docs.example/' }],
  files: [{ label: 'Report', url: 'https://files.example/r.pdf' }],
};

describe('POST /v1/projects', () => {
  it('creates a project with every field and returns what was stored', async () => {
    const http = await start();
    const me = await member('me');
    const res = await http.post('/v1/projects').set(me.auth).send(FULL).expect(201);

    expect(res.body).toMatchObject({
      title: 'Smart Garden',
      summary: 'Waters plants',
      descriptionHtml: '<h2>Why</h2><p>Because <strong>plants</strong>.</p>',
      category: 'research',
      status: 'completed',
      isPublic: true,
      isDraft: false,
      isOwner: true,
      ownerId: me.user.id,
      liveDemoUrl: 'https://demo.example/',
      repo: { url: 'https://github.com/x/y', stars: null },
      heroImageUrl: 'https://img.example/h.png',
      metadata: {
        startDate: '2025-01-15',
        endDate: '2025-06-01',
        course: 'IoT 101',
        professor: 'Dr. H',
      },
      technologies: ['Arduino', 'python'],
      tags: ['iot', 'Garden'],
      links: [{ label: 'Docs', url: 'https://docs.example/' }],
      files: [{ label: 'Report', url: 'https://files.example/r.pdf' }],
      attachments: [],
      source: 'manual',
    });
    const row = await rowOf(res.body.id as string);
    expect(row).toMatchObject({
      userId: me.user.id,
      title: 'Smart Garden',
      metaStartDate: '2025-01-15',
    });
    expect(await tagsOf(res.body.id as string)).toEqual(['iot', 'Garden']);
  });

  it('needs only a title; the rest defaults (public, published, other, ongoing)', async () => {
    const http = await start();
    const me = await member('me');
    const res = await http.post('/v1/projects').set(me.auth).send({ title: 'Bare' }).expect(201);
    expect(res.body).toMatchObject({
      isPublic: true,
      isDraft: false,
      category: 'other',
      status: 'ongoing',
      summary: null,
      descriptionHtml: null,
      technologies: [],
      tags: [],
      metadata: { startDate: null, endDate: null, course: null, professor: null },
    });
  });

  it('needs a token', async () => {
    const http = await start();
    await http.post('/v1/projects').send({ title: 'x' }).expect(401);
  });

  it.each([
    ['no title', {}],
    ['a blank title', { title: '   ' }],
    ['a title over 500 characters', { title: 'x'.repeat(501) }],
    ['an unknown key', { title: 'x', extra: 1 }],
    ['id', { title: 'x', id: newId() }],
    ['userId', { title: 'x', userId: newId() }],
    ['source', { title: 'x', source: 'github' }],
    ['aiSummary', { title: 'x', aiSummary: 'ai' }],
    ['repo fields', { title: 'x', repo: { stars: 5 } }],
    ['createdAt', { title: 'x', createdAt: '2020-01-01T00:00:00Z' }],
    ['a bad category', { title: 'x', category: 'fun' }],
    ['a bad status', { title: 'x', status: 'dead' }],
    ['javascript: demo URL', { title: 'x', liveDemoUrl: 'javascript:alert(1)' }],
    ['data: repo URL', { title: 'x', repoUrl: 'data:text/html,hi' }],
    ['an http hero image', { title: 'x', heroImageUrl: 'http://img.example/h.png' }],
    [
      'a hero image with credentials',
      { title: 'x', heroImageUrl: 'https://u:p@img.example/h.png' },
    ],
    ['a data: hero image', { title: 'x', heroImageUrl: 'data:image/png;base64,AAAA' }],
    ['javascript: in a link', { title: 'x', links: [{ label: 'a', url: 'javascript:alert(1)' }] }],
    ['a link without a label', { title: 'x', links: [{ label: ' ', url: 'https://a.example' }] }],
    ['an impossible date', { title: 'x', metadata: { startDate: '2025-02-30' } }],
    ['a malformed date', { title: 'x', metadata: { startDate: '15/01/2025' } }],
    ['a month 13', { title: 'x', metadata: { startDate: '2025-13-45' } }],
    ['year 0000', { title: 'x', metadata: { startDate: '0000-00-00' } }],
    [
      'a date before MySQL’s supported DATE range',
      { title: 'x', metadata: { startDate: '0999-12-31' } },
    ],
    ['year 0000-01-01', { title: 'x', metadata: { startDate: '0000-01-01' } }],
    [
      'end before start',
      { title: 'x', metadata: { startDate: '2025-05-01', endDate: '2025-04-30' } },
    ],
    ['unknown metadata key', { title: 'x', metadata: { weather: 'sunny' } }],
    ['21 tags', { title: 'x', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }],
    [
      '31 technologies',
      { title: 'x', technologies: Array.from({ length: 31 }, (_, i) => `t${i}`) },
    ],
    [
      '11 links',
      {
        title: 'x',
        links: Array.from({ length: 11 }, () => ({ label: 'a', url: 'https://a.example' })),
      },
    ],
    ['an empty tag', { title: 'x', tags: ['ok', '  '] }],
    [
      'a description over the limit after sanitizing',
      { title: 'x', descriptionHtml: `<p>${'a'.repeat(100_001)}</p>` },
    ],
    ['a non-string description', { title: 'x', descriptionHtml: 5 }],
  ])('rejects %s with 400 and writes nothing', async (_name, body) => {
    const http = await start();
    const me = await member('me');
    const res = await http.post('/v1/projects').set(me.auth).send(body).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(await countProjects(me.user.id)).toBe(0);
  });

  it('measures the description after sanitizing, not before', async () => {
    const http = await start({ PROJECT_DESCRIPTION_MAX_BYTES: '1000' });
    const me = await member('me');
    // 2 000 bytes of markup that sanitizes to a few characters
    const junk = '<script>'.repeat(1) + 'x'.repeat(1990) + '</script><p>ok</p>';
    const res = await http
      .post('/v1/projects')
      .set(me.auth)
      .send({ title: 'x', descriptionHtml: junk })
      .expect(201);
    expect(res.body.descriptionHtml).toBe('<p>ok</p>');
    await http
      .post('/v1/projects')
      .set(me.auth)
      .send({ title: 'x', descriptionHtml: `<p>${'a'.repeat(1001)}</p>` })
      .expect(400);
  });

  it('keeps a blank description as no description', async () => {
    const http = await start();
    const me = await member('me');
    for (const html of ['', '   ', '<script>alert(1)</script>']) {
      const res = await http
        .post('/v1/projects')
        .set(me.auth)
        .send({ title: 'x', descriptionHtml: html })
        .expect(201);
      expect(res.body.descriptionHtml).toBeNull();
    }
  });

  it('answers 409 at the per-user cap, and the cap is per user', async () => {
    const http = await start({ PROJECT_MAX_PER_USER: '2' });
    const me = await member('me');
    const other = await member('other');
    await http.post('/v1/projects').set(me.auth).send({ title: '1' }).expect(201);
    await http.post('/v1/projects').set(me.auth).send({ title: '2' }).expect(201);
    const res = await http.post('/v1/projects').set(me.auth).send({ title: '3' }).expect(409);
    expect(res.body.code).toBe('LIMIT_REACHED');
    await http.post('/v1/projects').set(other.auth).send({ title: '1' }).expect(201);
  });

  it('a private draft is invisible to everyone else until published', async () => {
    const http = await start();
    const me = await member('me');
    const id = (
      await http.post('/v1/projects').set(me.auth).send({ title: 'wip', isDraft: true }).expect(201)
    ).body.id as string;
    await http.get(`/v1/projects/${id}`).expect(404);
    await http.patch(`/v1/projects/${id}`).set(me.auth).send({ isDraft: false }).expect(200);
    await http.get(`/v1/projects/${id}`).expect(200);
    await http.patch(`/v1/projects/${id}`).set(me.auth).send({ isPublic: false }).expect(200);
    await http.get(`/v1/projects/${id}`).expect(404);
  });
});

describe('PATCH /v1/projects/:id', () => {
  async function created(http: request.Agent, auth: Record<string, string>, body: object = FULL) {
    return (await http.post('/v1/projects').set(auth).send(body).expect(201)).body as {
      id: string;
    };
  }

  it('changes only the named fields and returns the project', async () => {
    const http = await start();
    const me = await member('me');
    const { id } = await created(http, me.auth);
    const res = await http
      .patch(`/v1/projects/${id}`)
      .set(me.auth)
      .send({ title: 'Renamed', summary: null, status: 'archived' })
      .expect(200);
    expect(res.body).toMatchObject({
      title: 'Renamed',
      summary: null,
      status: 'archived',
      category: 'research',
      liveDemoUrl: 'https://demo.example/',
      tags: ['iot', 'Garden'],
      technologies: ['Arduino', 'python'],
      metadata: { startDate: '2025-01-15', course: 'IoT 101' },
    });
  });

  it('answers 200 for a patch that changes nothing', async () => {
    const http = await start();
    const me = await member('me');
    const { id } = await created(http, me.auth);
    await http.patch(`/v1/projects/${id}`).set(me.auth).send({ title: 'Smart Garden' }).expect(200);
    await http.patch(`/v1/projects/${id}`).set(me.auth).send({ status: 'completed' }).expect(200);
  });

  it('replaces tags, technologies and links as whole lists, and clears with []', async () => {
    const http = await start();
    const me = await member('me');
    const { id } = await created(http, me.auth);
    const res = await http
      .patch(`/v1/projects/${id}`)
      .set(me.auth)
      .send({ tags: ['new'], technologies: [], links: [] })
      .expect(200);
    expect(res.body).toMatchObject({
      tags: ['new'],
      technologies: [],
      links: [],
      files: FULL.files,
    });
    expect(await tagsOf(id)).toEqual(['new']);
  });

  it('merges metadata per key and validates dates against the stored ones', async () => {
    const http = await start();
    const me = await member('me');
    const { id } = await created(http, me.auth);
    const ok = await http
      .patch(`/v1/projects/${id}`)
      .set(me.auth)
      .send({ metadata: { course: null } })
      .expect(200);
    expect(ok.body.metadata).toEqual({
      startDate: '2025-01-15',
      endDate: '2025-06-01',
      course: null,
      professor: 'Dr. H',
    });
    // changing only the end date to before the stored start date is refused
    const bad = await http
      .patch(`/v1/projects/${id}`)
      .set(me.auth)
      .send({ metadata: { endDate: '2024-12-31' } })
      .expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect((await rowOf(id))?.metaEndDate).toBe('2025-06-01');
  });

  it.each([
    ['an empty patch', {}],
    ['id', { id: newId() }],
    ['userId', { userId: newId() }],
    ['source', { source: 'github' }],
    ['aiSummary', { aiSummary: 'x' }],
    ['unknown key', { nope: 1 }],
    ['a bad URL', { liveDemoUrl: 'javascript:alert(1)' }],
    ['an http hero', { heroImageUrl: 'http://a.example/x.png' }],
    ['a blank title', { title: ' ' }],
    ['a null title', { title: null }],
  ])('rejects %s with 400 and leaves the row alone', async (_name, body) => {
    const http = await start();
    const me = await member('me');
    const { id } = await created(http, me.auth);
    const before = await rowOf(id);
    await http.patch(`/v1/projects/${id}`).set(me.auth).send(body).expect(400);
    expect(await rowOf(id)).toEqual(before);
  });

  it('treats an empty metadata object as naming no key: a 200 that changes nothing', async () => {
    const http = await start();
    const me = await member('me');
    const { id } = await created(http, me.auth);
    const before = await rowOf(id);
    const res = await http
      .patch(`/v1/projects/${id}`)
      .set(me.auth)
      .send({ metadata: {} })
      .expect(200);
    expect(res.body.metadata).toMatchObject({ startDate: '2025-01-15', course: 'IoT 101' });
    expect(await rowOf(id)).toEqual(before);
  });

  it('answers 404 for a project that does not exist, with the body a stranger gets', async () => {
    const http = await start();
    const me = await member('me');
    const other = await member('other');
    const { id } = await created(http, other.auth);
    const stranger = await http
      .patch(`/v1/projects/${id}`)
      .set(me.auth)
      .send({ title: 'x' })
      .expect(404);
    const missing = await http
      .patch(`/v1/projects/${newId()}`)
      .set(me.auth)
      .send({ title: 'x' })
      .expect(404);
    expect(stranger.body).toEqual(missing.body);
  });
});

describe('DELETE /v1/projects/:id', () => {
  it('deletes the project and everything under it, then 404s', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user, {
      tags: ['a'],
      technologies: ['b'],
      attachments: [{ type: 'link', url: 'https://a.example' }],
    });
    await db
      .insertInto('projectTeamMembers')
      .values({ id: newId(), projectId: project.id, userId: null, name: 'Bob' })
      .execute();
    await http.delete(`/v1/projects/${project.id}`).set(me.auth).expect(204);
    expect(await rowOf(project.id)).toBeUndefined();
    for (const table of [
      'projectAttachments',
      'projectTags',
      'projectTechnologies',
      'projectTeamMembers',
    ] as const) {
      const left = await db
        .selectFrom(table)
        .select('projectId')
        .where('projectId', '=', project.id)
        .execute();
      expect(left, table).toHaveLength(0);
    }
    await http.get(`/v1/projects/${project.id}`).expect(404);
    await http.delete(`/v1/projects/${project.id}`).set(me.auth).expect(404);
  });
});

describe('a second user gets 404 on every write, and nothing changes', () => {
  it('PATCH and DELETE of someone else’s project, public or private', async () => {
    const http = await start();
    const owner = await member('owner');
    const intruder = await member('intruder');
    for (const isPublic of [true, false]) {
      const { project } = await createProject(db, owner.user, {
        title: 'Mine',
        isPublic,
        tags: ['t'],
      });
      const before = await rowOf(project.id);
      const patch = await http
        .patch(`/v1/projects/${project.id}`)
        .set(intruder.auth)
        .send({ title: 'Hacked', tags: [] });
      expect(patch.status, `PATCH isPublic=${String(isPublic)}`).toBe(404);
      const del = await http.delete(`/v1/projects/${project.id}`).set(intruder.auth);
      expect(del.status, `DELETE isPublic=${String(isPublic)}`).toBe(404);
      expect(await rowOf(project.id)).toEqual(before);
      expect(await tagsOf(project.id)).toEqual(['t']);
    }
  });

  it('401 without a token', async () => {
    const http = await start();
    const owner = await member('owner');
    const { project } = await createProject(db, owner.user);
    await http.patch(`/v1/projects/${project.id}`).send({ title: 'x' }).expect(401);
    await http.delete(`/v1/projects/${project.id}`).expect(401);
  });
});

describe('the sanitizer on every write path', () => {
  it.each(CORPUS)('neutralizes %s (%s) through create and patch', async (_name, _kind, html) => {
    const http = await start();
    const me = await member('me');
    const created = await http
      .post('/v1/projects')
      .set(me.auth)
      .send({ title: 'x', descriptionHtml: `<p>keep</p>${html}` })
      .expect(201);
    const id = created.body.id as string;
    const expected = sanitizeDescription(`<p>keep</p>${html}`);
    expect(created.body.descriptionHtml).toBe(expected === '' ? null : expected);
    expect(created.body.descriptionHtml).not.toMatch(
      /javascript:|onerror|onload|<script|<svg|<img|<iframe/i,
    );

    const patched = await http
      .patch(`/v1/projects/${id}`)
      .set(me.auth)
      .send({ descriptionHtml: html })
      .expect(200);
    const row = await rowOf(id);
    // the stored value is the sanitized one, and re-sanitizing it changes nothing
    expect(row?.descriptionHtml ?? null).toBe(patched.body.descriptionHtml);
    if (row?.descriptionHtml)
      expect(sanitizeDescription(row.descriptionHtml)).toBe(row.descriptionHtml);
  });

  it('re-sanitizes a stored value that a patch of another field carries along', async () => {
    const http = await start();
    const me = await member('me');
    // a row written outside the API, with markup the current allow-list refuses
    const { project } = await createProject(db, me.user, {
      descriptionHtml: '<p>ok</p><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>',
    });
    const res = await http
      .patch(`/v1/projects/${project.id}`)
      .set(me.auth)
      .send({ title: 'T' })
      .expect(200);
    expect(res.body.descriptionHtml).toBe('<p>ok</p><a>x</a>');
    expect((await rowOf(project.id))?.descriptionHtml).toBe('<p>ok</p><a>x</a>');
  });
});

describe('races, forced with a lock held on a second connection', () => {
  async function hold(sql: string, params: unknown[]): Promise<Connection> {
    const conn = await createConnection({ uri: testDatabaseUrl() });
    await conn.beginTransaction();
    await conn.query(sql, params);
    return conn;
  }

  it('two creates at cap - 1: one 201, one 409', async () => {
    const http = await start({ PROJECT_MAX_PER_USER: '2' });
    const me = await member('cap');
    await http.post('/v1/projects').set(me.auth).send({ title: '1' }).expect(201);

    const lock = await hold('SELECT id FROM users WHERE id = ? FOR UPDATE', [me.user.id]);
    const post = () =>
      http
        .post('/v1/projects')
        .set(me.auth)
        .send({ title: 'race' })
        .then((r) => r.status);
    const both = Promise.all([post(), post()]);
    await waitForLockWaiters(2);
    await lock.commit();
    await lock.end();

    expect((await both).sort()).toEqual([201, 409]);
    expect(await countProjects(me.user.id)).toBe(2);
  });

  it('two replace-all tag lists at once leave exactly one caller’s list', async () => {
    const http = await start();
    const me = await member('tags');
    const { project } = await createProject(db, me.user, { tags: [] });

    const lock = await hold('SELECT id FROM projects WHERE id = ? FOR UPDATE', [project.id]);
    const patch = (tags: string[]) =>
      http
        .patch(`/v1/projects/${project.id}`)
        .set(me.auth)
        .send({ tags })
        .then((r) => r.status);
    const both = Promise.all([patch(['a1', 'b1', 'c1']), patch(['x2', 'y2'])]);
    await waitForLockWaiters(2);
    await lock.commit();
    await lock.end();

    expect(await both).toEqual([200, 200]);
    const final = await tagsOf(project.id);
    expect([
      ['a1', 'b1', 'c1'],
      ['x2', 'y2'],
    ]).toContainEqual(final);
  });

  it('a patch that waits behind a delete answers 404, not 500', async () => {
    const http = await start();
    const me = await member('del');
    const { project } = await createProject(db, me.user);

    const lock = await hold('SELECT id FROM projects WHERE id = ? FOR UPDATE', [project.id]);
    const pending = http
      .patch(`/v1/projects/${project.id}`)
      .set(me.auth)
      .send({ title: 'late' })
      .then((r) => r);
    await waitForLockWaiters(1);
    await lock.query('DELETE FROM projects WHERE id = ?', [project.id]);
    await lock.commit();
    await lock.end();

    expect((await pending).status).toBe(404);
  });

  it('a create racing the account’s deletion answers 404, not a foreign-key 500', async () => {
    const http = await start();
    const me = await member('gone');
    const lock = await hold('SELECT id FROM users WHERE id = ? FOR UPDATE', [me.user.id]);
    const pending = http
      .post('/v1/projects')
      .set(me.auth)
      .send({ title: 'x' })
      .then((r) => r);
    await waitForLockWaiters(1);
    await lock.query('DELETE FROM users WHERE id = ?', [me.user.id]);
    await lock.commit();
    await lock.end();

    expect((await pending).status).toBe(404);
  });

  it('two patches of one project serialize: a cross-field rule cannot be broken by both halves', async () => {
    const http = await start();
    const me = await member('xfield');
    const { project } = await createProject(db, me.user, {
      metaStartDate: '2025-03-01',
      metaEndDate: '2025-06-01',
    });

    const lock = await hold('SELECT id FROM projects WHERE id = ? FOR UPDATE', [project.id]);
    const send = (metadata: object) =>
      http
        .patch(`/v1/projects/${project.id}`)
        .set(me.auth)
        .send({ metadata })
        .then((r) => r.status);
    // each is valid against the stored row alone; together they would invert the range
    const both = Promise.all([send({ startDate: '2025-05-01' }), send({ endDate: '2025-04-01' })]);
    await waitForLockWaiters(2);
    await lock.commit();
    await lock.end();

    expect((await both).sort()).toEqual([200, 400]);
    const row = await rowOf(project.id);
    expect(row!.metaEndDate! >= row!.metaStartDate!).toBe(true);
  });
});

describe('rate limits', () => {
  it('give each new write route its own per-caller budget', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '2', RATE_LIMIT_WINDOW_S: '60' });
    const me = await member('rl');
    const id = newId();
    const calls: [string, () => request.Test][] = [
      ['POST /projects', () => http.post('/v1/projects').set(me.auth).send({})],
      [
        'PATCH /projects/:id',
        () => http.patch(`/v1/projects/${id}`).set(me.auth).send({ title: 'x' }),
      ],
      ['DELETE /projects/:id', () => http.delete(`/v1/projects/${id}`).set(me.auth)],
    ];
    for (const [name, call] of calls) {
      expect((await call()).status, `${name} #1`).not.toBe(429);
      expect((await call()).status, `${name} #2`).not.toBe(429);
      expect((await call()).status, `${name} #3`).toBe(429);
    }
  });
});
