import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig, testDatabase } from '../../../testing/database.js';
import { createProfile, createProject, createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/**
 * M4 PR (a) through the whole stack against MySQL 8.4: who may read a project
 * (Q3 applied to projects), what a response may contain, and list pagination.
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();
const db = testDatabase();

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
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

async function member(label: string, over: Parameters<typeof createUser>[1] = {}) {
  const sub = `auth0|${label}-${newId()}`;
  const user = await createUser(db, {
    auth0Id: sub,
    name: label,
    email: `${label}-login@private.example`,
    phone: '+374 99 123456',
    birthday: '2001-02-03',
    ...over,
  });
  return { user, auth: { Authorization: `Bearer ${await tenant.sign({ sub })}` } };
}

interface Page {
  items: { id: string; title: string; isOwner: boolean; role: string }[];
  nextCursor: string | null;
}
const titlesOf = (body: unknown) => (body as Page).items.map((p) => p.title);

const FORBIDDEN_KEYS = [
  'auth0Id',
  'phone',
  'birthday',
  'email',
  'accessToken',
  'refreshToken',
  'githubRepoId',
  'github_repo_id',
];

function walk(node: unknown, keys: string[] = [], values: string[] = []) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, keys, values));
  else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      keys.push(k);
      walk(v, keys, values);
    }
  } else if (typeof node === 'string') values.push(node);
  return { keys, values };
}

beforeEach(async () => {
  await db.deleteFrom('users').execute();
});

type State = 'public' | 'private' | 'draft';
const STATE_ROW: Record<State, { isPublic: boolean; isDraft: boolean }> = {
  public: { isPublic: true, isDraft: false },
  private: { isPublic: false, isDraft: false },
  draft: { isPublic: true, isDraft: true },
};

describe('GET /v1/projects/:id (Q3 on projects)', () => {
  it.each([
    ['public', 'anonymous', 200],
    ['public', 'other', 200],
    ['public', 'owner', 200],
    ['private', 'anonymous', 404],
    ['private', 'other', 404],
    ['private', 'owner', 200],
    ['draft', 'anonymous', 404],
    ['draft', 'other', 404],
    ['draft', 'owner', 200],
  ] as const)('a %s project answers %s with %i', async (state, who, status) => {
    const http = await start();
    const owner = await member('owner');
    const other = await member('other');
    const { project } = await createProject(db, owner.user, {
      title: `P-${state}`,
      ...STATE_ROW[state],
    });

    const asked = http.get(`/v1/projects/${project.id}`);
    const caller = who === 'owner' ? owner : who === 'other' ? other : undefined;
    const res = await (caller ? asked.set(caller.auth) : asked).expect(status);
    if (status === 404) {
      const missing = await http.get(`/v1/projects/${newId()}`).expect(404);
      expect(res.body).toEqual(missing.body);
    } else {
      expect(res.body).toMatchObject({
        id: project.id,
        isOwner: who === 'owner',
        ownerId: owner.user.id,
      });
    }
  });

  it('is 401, not anonymous, for a token that is sent and bad', async () => {
    const http = await start();
    const owner = await member('owner');
    const { project } = await createProject(db, owner.user);
    await http
      .get(`/v1/projects/${project.id}`)
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);
  });

  it('returns every part of a project, children in their stored order', async () => {
    const http = await start();
    const owner = await member('owner', { avatarUrl: 'https://img.example/o.png' });
    const { project } = await createProject(db, owner.user, {
      title: 'Smart Garden',
      summary: 'Waters plants',
      descriptionHtml: '<p>Hi</p>',
      category: 'research',
      status: 'ongoing',
      liveDemoUrl: 'https://demo.example/',
      repoUrl: 'https://github.com/x/y',
      metaStartDate: '2025-01-15',
      metaEndDate: null,
      metaCourse: 'IoT 101',
      metaProfessor: 'Dr. Hovsepyan',
      technologies: ['Arduino', 'Python'],
      tags: ['iot', 'garden'],
      links: [{ label: 'Docs', url: 'https://docs.example/' }],
      attachments: [
        { type: 'image', url: 'https://img.example/1.png', title: 'Rig' },
        { type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Demo' },
        { type: 'video', url: 'https://evil.example/v', title: 'Other host' },
        { type: 'pdf', url: 'https://files.example/r.pdf' },
      ],
    });

    const res = await http.get(`/v1/projects/${project.id}`).expect(200);
    expect(res.body).toMatchObject({
      title: 'Smart Garden',
      summary: 'Waters plants',
      aiSummary: null,
      descriptionHtml: '<p>Hi</p>',
      category: 'research',
      status: 'ongoing',
      isPublic: true,
      isDraft: false,
      isOwner: false,
      liveDemoUrl: 'https://demo.example/',
      technologies: ['Arduino', 'Python'],
      tags: ['iot', 'garden'],
      links: [{ label: 'Docs', url: 'https://docs.example/' }],
      files: [],
      source: 'manual',
      metadata: {
        startDate: '2025-01-15',
        endDate: null,
        course: 'IoT 101',
        professor: 'Dr. Hovsepyan',
      },
      repo: { url: 'https://github.com/x/y', latestCommitDate: null, stars: null },
      owner: { id: owner.user.id, name: 'owner', avatarUrl: 'https://img.example/o.png' },
      team: [],
    });
    const attachments = res.body.attachments as Record<string, unknown>[];
    expect(attachments.map((a) => a.type)).toEqual(['image', 'video', 'video', 'pdf']);
    expect(attachments[1]).toMatchObject({
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
    // a video on a host that is not allow-listed gets no embed
    expect(attachments[2]).toMatchObject({ embedUrl: null, thumbnailUrl: null });
    expect(attachments[0]).toMatchObject({ embedUrl: null });
    expect(res.body.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  });

  it('shows only accepted team members, and links only to profiles the caller may read', async () => {
    const http = await start();
    const owner = await member('owner');
    const open = await member('open', { avatarUrl: 'https://img.example/open.png' });
    const hidden = await member('hidden', {
      isPublic: false,
      avatarUrl: 'https://img.example/hidden.png',
    });
    const { project } = await createProject(db, owner.user);
    const row = (
      name: string,
      userId: string | null,
      status: 'accepted' | 'pending',
      avatarUrl: string | null,
      sortOrder: number,
    ) =>
      db
        .insertInto('projectTeamMembers')
        .values({
          id: newId(),
          projectId: project.id,
          userId,
          name,
          role: 'Dev',
          status,
          avatarUrl,
          sortOrder,
        })
        .execute();
    await row('Open', open.user.id, 'accepted', 'https://img.example/open.png', 0);
    await row('Hidden', hidden.user.id, 'accepted', 'https://img.example/hidden.png', 1);
    await row('Gone', null, 'accepted', null, 2);
    const pending = await member('pending');
    await row('Pending', pending.user.id, 'pending', null, 3);

    const anon = await http.get(`/v1/projects/${project.id}`).expect(200);
    expect(anon.body.team).toEqual([
      expect.objectContaining({
        name: 'Open',
        userId: open.user.id,
        avatarUrl: 'https://img.example/open.png',
      }),
      expect.objectContaining({ name: 'Hidden', userId: null, avatarUrl: null }),
      expect.objectContaining({ name: 'Gone', userId: null }),
    ]);
    // the hidden member sees their own link
    const self = await http.get(`/v1/projects/${project.id}`).set(hidden.auth).expect(200);
    expect(self.body.team[1]).toMatchObject({ name: 'Hidden', userId: hidden.user.id });
  });

  it('shows no avatar for the owner of a private profile, except to the owner', async () => {
    const http = await start();
    const owner = await member('owner', {
      isPublic: false,
      avatarUrl: 'https://img.example/o.png',
    });
    const { project } = await createProject(db, owner.user);
    const anon = await http.get(`/v1/projects/${project.id}`).expect(200);
    expect(anon.body.owner).toEqual({ id: owner.user.id, name: 'owner', avatarUrl: null });
    const self = await http.get(`/v1/projects/${project.id}`).set(owner.auth).expect(200);
    expect(self.body.owner.avatarUrl).toBe('https://img.example/o.png');
  });
});

describe('GET /v1/me/projects', () => {
  it('lists the caller’s own projects in every state, never another user’s', async () => {
    const http = await start();
    const me = await member('me');
    const other = await member('other');
    await createProject(db, me.user, { title: 'A public', ...STATE_ROW.public });
    await createProject(db, me.user, { title: 'B private', ...STATE_ROW.private });
    await createProject(db, me.user, { title: 'C draft', ...STATE_ROW.draft });
    await createProject(db, me.user, { title: 'D private draft', isPublic: false, isDraft: true });
    await createProject(db, other.user, { title: 'Z theirs', ...STATE_ROW.public });

    const res = await http.get('/v1/me/projects?sort=name_asc').set(me.auth).expect(200);
    expect(titlesOf(res.body)).toEqual(['A public', 'B private', 'C draft', 'D private draft']);
    expect((res.body as Page).items.every((p) => p.isOwner && p.role === 'owner')).toBe(true);
    expect(res.body.nextCursor).toBeNull();

    const byState = async (state: string) =>
      titlesOf(
        (await http.get(`/v1/me/projects?state=${state}&sort=name_asc`).set(me.auth).expect(200))
          .body,
      );
    expect(await byState('published')).toEqual(['A public']);
    expect(await byState('private')).toEqual(['B private']);
    // a private draft is a draft, not "private"
    expect(await byState('draft')).toEqual(['C draft', 'D private draft']);
  });

  it('needs a token', async () => {
    const http = await start();
    await http.get('/v1/me/projects').expect(401);
  });
});

describe('GET /v1/users/:id/projects', () => {
  it('lists only public, published projects, to anyone, the owner included', async () => {
    const http = await start();
    const owner = await member('owner');
    const other = await member('other');
    await createProject(db, owner.user, { title: 'Open', ...STATE_ROW.public });
    await createProject(db, owner.user, { title: 'Closed', ...STATE_ROW.private });
    await createProject(db, owner.user, { title: 'Wip', ...STATE_ROW.draft });

    for (const auth of [undefined, other.auth, owner.auth]) {
      const asked = http.get(`/v1/users/${owner.user.id}/projects`);
      const res = await (auth ? asked.set(auth) : asked).expect(200);
      expect(titlesOf(res.body)).toEqual(['Open']);
    }
  });

  it('answers 404 for a private profile (to others) and for an unknown user, with the same body', async () => {
    const http = await start();
    const owner = await member('owner', { isPublic: false });
    const other = await member('other');
    await createProject(db, owner.user, { title: 'Open', ...STATE_ROW.public });

    const anon = await http.get(`/v1/users/${owner.user.id}/projects`).expect(404);
    await http.get(`/v1/users/${owner.user.id}/projects`).set(other.auth).expect(404);
    const missing = await http.get(`/v1/users/${newId()}/projects`).expect(404);
    expect(anon.body).toEqual(missing.body);
    // the owner of the private profile still reads their published projects here
    const self = await http.get(`/v1/users/${owner.user.id}/projects`).set(owner.auth).expect(200);
    expect(self.body.items).toHaveLength(1);
    // ... and an individual public project stays readable by id
    const [item] = self.body.items as { id: string }[];
    await http.get(`/v1/projects/${item!.id}`).expect(200);
  });

  it('is 401 for a bad token and 400 for state, which is the owner’s filter', async () => {
    const http = await start();
    const owner = await member('owner');
    await http
      .get(`/v1/users/${owner.user.id}/projects`)
      .set('Authorization', 'Bearer nope')
      .expect(401);
    await http.get(`/v1/users/${owner.user.id}/projects?state=draft`).expect(400);
  });
});

describe('no private project leaks into a public response', () => {
  it('keeps a marker out of every public read, as anonymous and as another user', async () => {
    const http = await start();
    const owner = await createProfile(db, { name: 'Owner', isPublic: true });
    const other = await member('other');
    const MARK = 'LEAKMARKER-7f3a';
    const secret = (state: State) =>
      createProject(db, owner.user, {
        title: `${MARK} title ${state}`,
        summary: `${MARK} summary`,
        descriptionHtml: `<p>${MARK}</p>`,
        liveDemoUrl: `https://${MARK.toLowerCase()}.example/`,
        technologies: [`${MARK}-tech`],
        tags: [`${MARK}-tag`],
        attachments: [
          { type: 'link', url: `https://${MARK.toLowerCase()}.example/a`, title: MARK },
        ],
        ...STATE_ROW[state],
      });
    const priv = await secret('private');
    const draft = await secret('draft');
    await createProject(db, owner.user, { title: 'Visible', ...STATE_ROW.public });

    for (const auth of [undefined, other.auth]) {
      const get = (path: string) => {
        const r = http.get(path);
        return auth ? r.set(auth) : r;
      };
      const bodies = [
        (await get(`/v1/users/${owner.user.id}`).expect(200)).body,
        (await get(`/v1/users/${owner.user.id}/projects`).expect(200)).body,
        (await get(`/v1/users/${owner.user.id}/projects?q=${MARK}`).expect(200)).body,
        (await get(`/v1/users/${owner.user.id}/projects?tag=${MARK}-tag`).expect(200)).body,
        (await get(`/v1/users/${owner.user.id}/projects?technology=${MARK}-tech`).expect(200)).body,
        (await get(`/v1/projects/${priv.project.id}`).expect(404)).body,
        (await get(`/v1/projects/${draft.project.id}`).expect(404)).body,
      ];
      for (const body of bodies) {
        const { keys, values } = walk(body);
        expect(
          values.some((v) => v.includes(MARK)),
          JSON.stringify(body),
        ).toBe(false);
        for (const k of FORBIDDEN_KEYS) expect(keys).not.toContain(k);
      }
      expect((bodies[1] as { items: unknown[] }).items).toHaveLength(1);
      expect((bodies[2] as { items: unknown[] }).items).toHaveLength(0);
    }
    expect(logs.text()).not.toContain(MARK);
  });
});

describe('list filters', () => {
  it('filters by category, status, tag, technology and text, case-insensitively', async () => {
    const http = await start();
    const me = await member('me');
    await createProject(db, me.user, {
      title: 'Garden bot',
      category: 'research',
      status: 'ongoing',
      technologies: ['Arduino'],
      tags: ['IoT'],
    });
    await createProject(db, me.user, {
      title: 'Web shop',
      category: 'course',
      status: 'completed',
      technologies: ['React'],
      tags: ['web'],
    });
    await createProject(db, me.user, {
      title: '100% done_deal',
      category: 'other',
      technologies: ['Go'],
    });
    const titles = async (query: string) =>
      titlesOf(
        (await http.get(`/v1/me/projects?sort=name_asc&${query}`).set(me.auth).expect(200)).body,
      );

    expect(await titles('category=research')).toEqual(['Garden bot']);
    expect(await titles('status=completed')).toEqual(['Web shop']);
    expect(await titles('tag=iot')).toEqual(['Garden bot']);
    expect(await titles('technology=REACT')).toEqual(['Web shop']);
    expect(await titles('q=GARDEN')).toEqual(['Garden bot']);
    expect(await titles('q=ardui')).toEqual(['Garden bot']);
    // short terms work (no FULLTEXT): "go" matches the technology Go
    expect(await titles('q=go')).toEqual(['100% done_deal']);
    // wildcards in the search text are text
    expect(await titles('q=%25')).toEqual(['100% done_deal']);
    expect(await titles('q=_')).toEqual(['100% done_deal']);
    expect(await titles('q=zzz')).toEqual([]);
  });
});

describe('pagination', () => {
  const SORTS = ['newest', 'oldest', 'updated', 'name_asc', 'name_desc'] as const;

  it.each(SORTS)('walks %s once per row while a row is added mid-walk', async (sort) => {
    const http = await start();
    const me = await member('me');
    const sameSecond = new Date('2026-01-01T00:00:00Z');
    const ids = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const { project } = await createProject(db, me.user, {
        title: `Project ${String(i % 10)}`, // equal titles too
        createdAt: sameSecond,
        updatedAt: sameSecond,
      });
      ids.add(project.id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = `/v1/me/projects?sort=${sort}&limit=7${cursor ? `&cursor=${cursor}` : ''}`;
      const res: request.Response = await http.get(url).set(me.auth).expect(200);
      seen.push(...(res.body as Page).items.map((p) => p.id));
      cursor = (res.body as Page).nextCursor;
      pages++;
      if (pages === 2)
        await createProject(db, me.user, {
          title: 'Project 5',
          createdAt: sameSecond,
          updatedAt: sameSecond,
        });
    } while (cursor);

    expect(new Set(seen).size, 'no row twice').toBe(seen.length);
    for (const id of ids) expect(seen, 'no original row skipped').toContain(id);
    expect(pages).toBeGreaterThanOrEqual(5);
  });

  it('orders by the sort key, id last', async () => {
    const http = await start();
    const me = await member('me');
    await createProject(db, me.user, { title: 'b', createdAt: new Date('2026-01-02T00:00:00Z') });
    await createProject(db, me.user, { title: 'A', createdAt: new Date('2026-01-03T00:00:00Z') });
    await createProject(db, me.user, { title: 'c', createdAt: new Date('2026-01-01T00:00:00Z') });
    const titles = async (sort: string) =>
      titlesOf((await http.get(`/v1/me/projects?sort=${sort}`).set(me.auth).expect(200)).body);
    expect(await titles('newest')).toEqual(['A', 'b', 'c']);
    expect(await titles('oldest')).toEqual(['c', 'b', 'A']);
    expect(await titles('name_asc')).toEqual(['A', 'b', 'c']); // case-insensitive
    expect(await titles('name_desc')).toEqual(['c', 'b', 'A']);
  });

  it('refuses a cursor for another sort, a forged one, an over-large page and unknown keys', async () => {
    const http = await start({ PROJECTS_PAGE_MAX: '5', PROJECTS_PAGE_SIZE: '5' });
    const me = await member('me');
    for (let i = 0; i < 3; i++) await createProject(db, me.user);
    const page = await http.get('/v1/me/projects?limit=2').set(me.auth).expect(200);
    const cursor = page.body.nextCursor as string;
    expect(cursor).toBeTruthy();

    const bad = (query: string) => http.get(`/v1/me/projects?${query}`).set(me.auth).expect(400);
    await bad(`sort=oldest&cursor=${cursor}`);
    await bad('cursor=garbage');
    await bad(
      `cursor=${Buffer.from('{"s":"newest","v":1,"id":"x","extra":1}').toString('base64url')}`,
    );
    await bad('limit=6');
    await bad('limit=0');
    await bad('owner=someone');
    await bad('sort=random');
    await http.get('/v1/me/projects?limit=5').set(me.auth).expect(200);
  });
});

describe('rate limits', () => {
  it('give every new route its own per-caller budget', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '2', RATE_LIMIT_WINDOW_S: '60' });
    const me = await member('rl');
    const calls: [string, () => request.Test][] = [
      ['GET /projects/:id', () => http.get(`/v1/projects/${newId()}`).set(me.auth)],
      ['GET /me/projects', () => http.get('/v1/me/projects').set(me.auth)],
      ['GET /users/:id/projects', () => http.get(`/v1/users/${me.user.id}/projects`).set(me.auth)],
    ];
    for (const [name, call] of calls) {
      expect((await call()).status, `${name} #1`).not.toBe(429);
      expect((await call()).status, `${name} #2`).not.toBe(429);
      expect((await call()).status, `${name} #3`).toBe(429);
    }
  });
});
