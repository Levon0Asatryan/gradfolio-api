import type { NestExpressApplication } from '@nestjs/platform-express';
import { createConnection, type Connection } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testConfig, testDatabase, testDatabaseUrl } from '../../../testing/database.js';
import { createProject, createUser } from '../../../testing/factories.js';
import { FakeFileStorage } from '../../../testing/fake-storage.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/**
 * M4 PR (c), attachments: add / change / delete / reorder per type, the
 * second-user matrix, and the races (forced with a lock on a second connection
 * and `waitForLockWaiters`, never a sleep).
 */

const BUCKET = 'test-bucket';
let tenant: TestTenant;
let app: NestExpressApplication | undefined;
let storage: FakeFileStorage;
const logs = captureLogs();
const db = testDatabase();

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('img'),
]);
const YT = 'https://youtu.be/dQw4w9WgXcQ';

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
beforeEach(async () => {
  await db.deleteFrom('users').execute();
  storage = new FakeFileStorage(BUCKET);
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
      STORAGE_BUCKET: BUCKET,
      ...env,
    }),
    undefined,
    { logs, storage },
  );
  return request(app.getHttpServer());
}

async function member(label: string) {
  const sub = `auth0|${label}-${newId()}`;
  const user = await createUser(db, { auth0Id: sub, name: label });
  return { user, auth: { Authorization: `Bearer ${await tenant.sign({ sub })}` } };
}
const idsOf = (list: unknown) => (list as { id: string }[]).map((a) => a.id);
type Http = Awaited<ReturnType<typeof start>>;
type Who = Awaited<ReturnType<typeof member>>;

const rows = (projectId: string) =>
  db
    .selectFrom('projectAttachments')
    .selectAll()
    .where('projectId', '=', projectId)
    .orderBy('sortOrder')
    .orderBy('id')
    .execute();

async function add(http: Http, who: Who, projectId: string, body: object, status = 201) {
  return http.post(`/v1/projects/${projectId}/attachments`).set(who.auth).send(body).expect(status);
}

describe('POST /v1/projects/:id/attachments', () => {
  it('adds every type; each goes last, and a video gets its embed and thumbnail', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);

    const image = await add(http, me, project.id, {
      type: 'image',
      url: 'https://img.example/a.png',
      title: 'Rig',
    });
    const video = await add(http, me, project.id, { type: 'video', url: YT });
    const pdf = await add(http, me, project.id, {
      type: 'pdf',
      url: 'https://files.example/r.pdf',
    });
    const link = await add(http, me, project.id, {
      type: 'link',
      url: 'https://a.example',
      title: '  ',
    });

    expect(image.body).toEqual({
      id: expect.any(String),
      type: 'image',
      url: 'https://img.example/a.png',
      title: 'Rig',
      thumbnailUrl: null,
      embedUrl: null,
    });
    expect(video.body).toMatchObject({
      type: 'video',
      url: YT,
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
    expect(link.body.title).toBeNull();
    expect((await rows(project.id)).map((r) => r.type)).toEqual(['image', 'video', 'pdf', 'link']);
    const detail = await http.get(`/v1/projects/${project.id}`).expect(200);
    expect(idsOf(detail.body.attachments)).toEqual(
      [image, video, pdf, link].map((r) => r.body.id as string),
    );
    expect(pdf.body.type).toBe('pdf');
  });

  it.each([
    ['http', { type: 'image', url: 'http://img.example/a.png' }],
    ['javascript:', { type: 'link', url: 'javascript:alert(1)' }],
    ['data:', { type: 'image', url: 'data:image/png;base64,AAAA' }],
    ['credentials', { type: 'link', url: 'https://u:p@a.example' }],
    ['no type', { url: 'https://a.example' }],
    ['a bad type', { type: 'audio', url: 'https://a.example' }],
    ['no url', { type: 'link' }],
    ['an unknown key', { type: 'link', url: 'https://a.example', x: 1 }],
    ['id', { type: 'link', url: 'https://a.example', id: newId() }],
    ['sortOrder', { type: 'link', url: 'https://a.example', sortOrder: -9 }],
    ['thumbnailUrl', { type: 'video', url: YT, thumbnailUrl: 'https://evil.example/t.png' }],
    ['embedUrl', { type: 'video', url: YT, embedUrl: 'https://evil.example/e' }],
    [
      'a title over 500 characters',
      { type: 'link', url: 'https://a.example', title: 'x'.repeat(501) },
    ],
    ['a video on another host', { type: 'video', url: 'https://evil.example/watch?v=dQw4w9WgXcQ' }],
    [
      'a lookalike video host',
      { type: 'video', url: 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ' },
    ],
    ['a video without an id', { type: 'video', url: 'https://www.youtube.com/@someone' }],
    ['a video as http', { type: 'video', url: 'http://youtu.be/dQw4w9WgXcQ' }],
  ])('refuses %s with 400 and writes nothing', async (_name, body) => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const res = await add(http, me, project.id, body, 400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(await rows(project.id)).toHaveLength(0);
  });

  it('refuses a link at an uploaded file, and files in a video: only images and PDFs are registered', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const key = `u/${me.user.id}/f.png`;
    storage.put(key, PNG, 'image/png');
    const url = `https://${BUCKET}.storage.googleapis.com/${key}`;
    await add(http, me, project.id, { type: 'link', url }, 400);
    await add(http, me, project.id, { type: 'video', url }, 400);
    expect((await storage.stat(key))?.claimed).toBe(false);
  });

  it('registers an uploaded image or PDF once, with the right kind', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const png = `u/${me.user.id}/a.png`;
    const pdf = `u/${me.user.id}/a.pdf`;
    storage.put(png, PNG, 'image/png');
    storage.put(pdf, Buffer.from('%PDF-1.7 x'), 'application/pdf');
    const u = (k: string) => `https://${BUCKET}.storage.googleapis.com/${k}`;

    await add(http, me, project.id, { type: 'pdf', url: u(png) }, 400); // an image is not a PDF
    await add(http, me, project.id, { type: 'image', url: u(pdf) }, 400); // nor the reverse
    const a = await add(http, me, project.id, { type: 'image', url: u(png) });
    const b = await add(http, me, project.id, { type: 'pdf', url: u(pdf), title: 'R' });
    expect(a.body.url).toContain('X-Goog-Signature=read-');
    expect(b.body.url).toContain(pdf);
    expect((await rows(project.id)).map((r) => r.url)).toEqual([u(png), u(pdf)]);
    const again = await add(http, me, project.id, { type: 'image', url: u(png) }, 400);
    expect(again.body.code).toBe('FILE_IN_USE');
  });

  it('answers 409 at the per-project cap, and the cap holds under a race', async () => {
    const http = await start({ PROJECT_MAX_ATTACHMENTS: '2' });
    const me = await member('cap');
    const { project } = await createProject(db, me.user);
    await add(http, me, project.id, { type: 'link', url: 'https://a.example/1' });

    const conn = await hold('SELECT id FROM projects WHERE id = ? FOR UPDATE', [project.id]);
    const send = () =>
      http
        .post(`/v1/projects/${project.id}/attachments`)
        .set(me.auth)
        .send({ type: 'link', url: 'https://a.example/x' })
        .then((r) => r.status);
    const both = Promise.all([send(), send()]);
    await waitForLockWaiters(2);
    await conn.commit();
    await conn.end();
    expect((await both).sort()).toEqual([201, 409]);
    expect(await rows(project.id)).toHaveLength(2);
    const full = await http
      .post(`/v1/projects/${project.id}/attachments`)
      .set(me.auth)
      .send({ type: 'link', url: 'https://a.example/y' })
      .expect(409);
    expect(full.body.code).toBe('LIMIT_REACHED');
  });
});

async function hold(sql: string, params: unknown[]): Promise<Connection> {
  const conn = await createConnection({ uri: testDatabaseUrl() });
  await conn.beginTransaction();
  await conn.query(sql, params);
  return conn;
}

describe('PATCH /v1/projects/:id/attachments/:attachmentId', () => {
  async function seeded(http: Http, me: Who) {
    const { project } = await createProject(db, me.user);
    const a = (await add(http, me, project.id, { type: 'video', url: YT, title: 'Demo' })).body as {
      id: string;
    };
    return { project, a };
  }

  it('changes the title and the URL, revalidated for the type; a video gets its new embed', async () => {
    const http = await start();
    const me = await member('me');
    const { project, a } = await seeded(http, me);
    const res = await http
      .patch(`/v1/projects/${project.id}/attachments/${a.id}`)
      .set(me.auth)
      .send({ title: null, url: 'https://vimeo.com/76979871' })
      .expect(200);
    expect(res.body).toMatchObject({
      title: null,
      embedUrl: 'https://player.vimeo.com/video/76979871',
      thumbnailUrl: null,
    });
    await http
      .patch(`/v1/projects/${project.id}/attachments/${a.id}`)
      .set(me.auth)
      .send({ url: 'https://evil.example/v' })
      .expect(400);
    expect((await rows(project.id))[0]?.url).toBe('https://vimeo.com/76979871');
  });

  it('answers 200 for a patch that changes nothing', async () => {
    const http = await start();
    const me = await member('me');
    const { project, a } = await seeded(http, me);
    await http
      .patch(`/v1/projects/${project.id}/attachments/${a.id}`)
      .set(me.auth)
      .send({ title: 'Demo', url: YT })
      .expect(200);
  });

  it.each([
    ['an empty patch', {}],
    ['type', { type: 'link' }],
    ['id', { id: newId() }],
    ['thumbnailUrl', { thumbnailUrl: 'https://evil.example/t.png' }],
    ['sortOrder', { sortOrder: 5 }],
    ['an http url', { url: 'http://youtu.be/dQw4w9WgXcQ' }],
  ])('refuses %s with 400 and leaves the row alone', async (_name, body) => {
    const http = await start();
    const me = await member('me');
    const { project, a } = await seeded(http, me);
    const before = await rows(project.id);
    await http
      .patch(`/v1/projects/${project.id}/attachments/${a.id}`)
      .set(me.auth)
      .send(body)
      .expect(400);
    expect(await rows(project.id)).toEqual(before);
  });

  it('replacing an uploaded file deletes the old object; the same file sent back deletes nothing', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const u = (k: string) => `https://${BUCKET}.storage.googleapis.com/${k}`;
    const k1 = `u/${me.user.id}/1.png`;
    const k2 = `u/${me.user.id}/2.png`;
    storage.put(k1, PNG, 'image/png');
    storage.put(k2, PNG, 'image/png');
    const a = (await add(http, me, project.id, { type: 'image', url: u(k1) })).body as {
      id: string;
      url: string;
    };

    await http
      .patch(`/v1/projects/${project.id}/attachments/${a.id}`)
      .set(me.auth)
      .send({ url: a.url, title: 't' })
      .expect(200);
    expect(storage.deleted).toEqual([]);
    await http
      .patch(`/v1/projects/${project.id}/attachments/${a.id}`)
      .set(me.auth)
      .send({ url: u(k2) })
      .expect(200);
    expect(storage.deleted).toEqual([k1]);
    expect((await rows(project.id))[0]?.url).toBe(u(k2));
  });
});

describe('DELETE /v1/projects/:id/attachments/:attachmentId', () => {
  it('deletes the row, then the object, and 404s the second time', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const key = `u/${me.user.id}/1.pdf`;
    storage.put(key, Buffer.from('%PDF-1.7 x'), 'application/pdf');
    const a = (
      await add(http, me, project.id, {
        type: 'pdf',
        url: `https://${BUCKET}.storage.googleapis.com/${key}`,
      })
    ).body as { id: string };
    await http.delete(`/v1/projects/${project.id}/attachments/${a.id}`).set(me.auth).expect(204);
    expect(await rows(project.id)).toHaveLength(0);
    expect(storage.deleted).toEqual([key]);
    await http.delete(`/v1/projects/${project.id}/attachments/${a.id}`).set(me.auth).expect(404);
  });
});

describe('PUT /v1/projects/:id/attachments/order', () => {
  async function three(http: Http, me: Who) {
    const { project } = await createProject(db, me.user);
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      ids.push(
        (
          (await add(http, me, project.id, { type: 'link', url: `https://a.example/${n}` }))
            .body as { id: string }
        ).id,
      );
    }
    return { project, ids };
  }

  it('sets exactly the order given and returns the list', async () => {
    const http = await start();
    const me = await member('me');
    const { project, ids } = await three(http, me);
    const order = [ids[2]!, ids[0]!, ids[1]!];
    const res = await http
      .put(`/v1/projects/${project.id}/attachments/order`)
      .set(me.auth)
      .send({ ids: order })
      .expect(200);
    expect(idsOf(res.body)).toEqual(order);
    expect((await rows(project.id)).map((r) => r.id)).toEqual(order);
    const detail = await http.get(`/v1/projects/${project.id}`).expect(200);
    expect(idsOf(detail.body.attachments)).toEqual(order);
  });

  it.each([
    ['a repeated id', (ids: string[]) => [ids[0]!, ids[0]!, ids[1]!], 400],
    ['an unknown id', (ids: string[]) => [ids[0]!, ids[1]!, newId()], 404],
    ['a missing id', (ids: string[]) => [ids[0]!, ids[1]!], 409],
    ['an empty list', () => [], 409],
  ])('answers %s with %i and changes nothing', async (_name, build, status) => {
    const http = await start();
    const me = await member('me');
    const { project, ids } = await three(http, me);
    await http
      .put(`/v1/projects/${project.id}/attachments/order`)
      .set(me.auth)
      .send({ ids: build(ids) })
      .expect(status);
    expect((await rows(project.id)).map((r) => r.id)).toEqual(ids);
  });

  it('answers 404 for another project’s attachment id, and moves nothing', async () => {
    const http = await start();
    const me = await member('me');
    const { project, ids } = await three(http, me);
    const { project: other } = await createProject(db, me.user);
    const foreign = (
      (await add(http, me, other.id, { type: 'link', url: 'https://a.example/f' })).body as {
        id: string;
      }
    ).id;
    await http
      .put(`/v1/projects/${project.id}/attachments/order`)
      .set(me.auth)
      .send({ ids: [ids[0]!, ids[1]!, foreign] })
      .expect(404);
    expect((await rows(project.id)).map((r) => r.id)).toEqual(ids);
    expect((await rows(other.id)).map((r) => r.id)).toEqual([foreign]);
  });

  it('a reorder racing an add sees the new attachment and answers 409 instead of dropping it', async () => {
    const http = await start();
    const me = await member('race');
    const { project, ids } = await three(http, me);
    const lock = await hold('SELECT id FROM projects WHERE id = ? FOR UPDATE', [project.id]);
    const pending = http
      .put(`/v1/projects/${project.id}/attachments/order`)
      .set(me.auth)
      .send({ ids })
      .then((r) => r);
    await waitForLockWaiters(1);
    await lock.query(
      "INSERT INTO project_attachments (id, project_id, type, url, sort_order) VALUES (?, ?, 'link', 'https://a.example/late', 99)",
      [newId(), project.id],
    );
    await lock.commit();
    await lock.end();

    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORDER_STALE');
    expect(await rows(project.id)).toHaveLength(4);
  });
});

describe('a second user gets 404 on every attachment write, and nothing changes', () => {
  it('add, change, delete, reorder -- on a public and on a private project', async () => {
    const http = await start();
    const owner = await member('owner');
    const intruder = await member('intruder');
    for (const isPublic of [true, false]) {
      const { project } = await createProject(db, owner.user, {
        isPublic,
        attachments: [{ type: 'link', url: 'https://a.example/1', title: 'one' }],
      });
      const [a] = await rows(project.id);
      const before = await rows(project.id);
      const base = `/v1/projects/${project.id}/attachments`;
      const label = `isPublic=${String(isPublic)}`;

      expect(
        (await http.post(base).set(intruder.auth).send({ type: 'link', url: 'https://x.example' }))
          .status,
        `POST ${label}`,
      ).toBe(404);
      expect(
        (await http.patch(`${base}/${a!.id}`).set(intruder.auth).send({ title: 'x' })).status,
        `PATCH ${label}`,
      ).toBe(404);
      expect(
        (await http.delete(`${base}/${a!.id}`).set(intruder.auth)).status,
        `DELETE ${label}`,
      ).toBe(404);
      expect(
        (
          await http
            .put(`${base}/order`)
            .set(intruder.auth)
            .send({ ids: [a!.id] })
        ).status,
        `PUT ${label}`,
      ).toBe(404);
      expect(await rows(project.id)).toEqual(before);
    }
  });

  it('an attachment id of another project, reached through the intruder’s own project, is 404', async () => {
    const http = await start();
    const owner = await member('owner');
    const intruder = await member('intruder');
    const { project: theirs } = await createProject(db, owner.user, {
      attachments: [{ type: 'link', url: 'https://a.example/1' }],
    });
    const { project: mine } = await createProject(db, intruder.user);
    const [a] = await rows(theirs.id);
    await http
      .patch(`/v1/projects/${mine.id}/attachments/${a!.id}`)
      .set(intruder.auth)
      .send({ title: 'x' })
      .expect(404);
    await http
      .delete(`/v1/projects/${mine.id}/attachments/${a!.id}`)
      .set(intruder.auth)
      .expect(404);
    expect(await rows(theirs.id)).toHaveLength(1);
  });

  it('401 without a token', async () => {
    const http = await start();
    const owner = await member('owner');
    const { project } = await createProject(db, owner.user);
    await http
      .post(`/v1/projects/${project.id}/attachments`)
      .send({ type: 'link', url: 'https://a.example' })
      .expect(401);
    await http.put(`/v1/projects/${project.id}/attachments/order`).send({ ids: [] }).expect(401);
  });
});

describe('rate limits', () => {
  it('give each attachment route its own per-caller budget', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '2', RATE_LIMIT_WINDOW_S: '60' });
    const me = await member('rl');
    const p = newId();
    const a = newId();
    const calls: [string, () => request.Test][] = [
      ['POST', () => http.post(`/v1/projects/${p}/attachments`).set(me.auth).send({})],
      [
        'PATCH',
        () => http.patch(`/v1/projects/${p}/attachments/${a}`).set(me.auth).send({ title: 'x' }),
      ],
      ['DELETE', () => http.delete(`/v1/projects/${p}/attachments/${a}`).set(me.auth)],
      [
        'PUT order',
        () => http.put(`/v1/projects/${p}/attachments/order`).set(me.auth).send({ ids: [] }),
      ],
    ];
    for (const [name, call] of calls) {
      expect((await call()).status, `${name} #1`).not.toBe(429);
      expect((await call()).status, `${name} #2`).not.toBe(429);
      expect((await call()).status, `${name} #3`).toBe(429);
    }
  });
});
