import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { objectKeyOf } from '../../../core/storage/file-rules.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig, testDatabase } from '../../../testing/database.js';
import { createProject, createUser } from '../../../testing/factories.js';
import { FakeFileStorage } from '../../../testing/fake-storage.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/**
 * M4 PR (c), storage: signed uploads, registering an uploaded file on write,
 * signed reads, and deleting objects with their rows. Storage is an in-memory
 * fake with GCS's claim rule (proved against the real bucket, plan §3.3).
 */

const BUCKET = 'test-bucket';
let tenant: TestTenant;
let app: NestExpressApplication | undefined;
let storage: FakeFileStorage;
const logs = captureLogs();
const db = testDatabase();

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('image-bytes'),
]);
const PDF = Buffer.from('%PDF-1.7\nbody');
const HTML_AS_PNG = Buffer.from('<html><script>alert(1)</script></html>');

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

async function start(env: NodeJS.ProcessEnv = {}, withStorage = true) {
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'warn',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
      ...(withStorage ? { STORAGE_BUCKET: BUCKET } : {}),
      ...env,
    }),
    undefined,
    { logs, storage },
  );
  return request(app.getHttpServer());
}

async function member(label: string, over: Parameters<typeof createUser>[1] = {}) {
  const sub = `auth0|${label}-${newId()}`;
  const user = await createUser(db, { auth0Id: sub, name: label, ...over });
  return { user, auth: { Authorization: `Bearer ${await tenant.sign({ sub })}` } };
}

type Http = Awaited<ReturnType<typeof start>>;
type Who = Awaited<ReturnType<typeof member>>;

/** The whole browser flow: ask for a ticket, PUT the bytes, return the file URL. */
async function upload(
  http: Http,
  who: Who,
  purpose: 'avatar' | 'hero' | 'attachment',
  opts: { body?: Buffer; contentType?: string; projectId?: string } = {},
) {
  const body = opts.body ?? PNG;
  const contentType = opts.contentType ?? 'image/png';
  const res = await http
    .post('/v1/me/uploads')
    .set(who.auth)
    .send({ purpose, contentType, size: body.length, projectId: opts.projectId })
    .expect(201);
  const fileUrl = res.body.fileUrl as string;
  const key = objectKeyOf(fileUrl, BUCKET)!;
  // the browser's PUT, with the signed headers enforced as the bucket enforces them
  expect(storage.putSigned(res.body as never, body)).toBe(200);
  return {
    fileUrl,
    key,
    ticket: res.body as { uploadUrl: string; headers: Record<string, string> },
  };
}

const rowOf = (id: string) =>
  db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
const avatarOf = async (id: string) =>
  (await db.selectFrom('users').select('avatarUrl').where('id', '=', id).executeTakeFirstOrThrow())
    .avatarUrl;

describe('POST /v1/me/uploads', () => {
  it('signs one PUT: type and exact size pinned, a key under the caller’s prefix, a short life', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const res = await http
      .post('/v1/me/uploads')
      .set(me.auth)
      .send({ purpose: 'hero', contentType: 'image/jpeg', size: 1234, projectId: project.id })
      .expect(201);

    expect(res.body).toMatchObject({
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-goog-content-length-range': '1234,1234',
        'x-goog-if-generation-match': '0',
      },
    });
    const key = objectKeyOf(res.body.fileUrl as string, BUCKET)!;
    expect(key).toMatch(new RegExp(`^u/${me.user.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(res.body.uploadUrl).toContain(key);
    expect(res.body.uploadUrl).toContain('X-Goog-Expires=300');
    const life = new Date(res.body.expiresAt as string).getTime() - Date.now();
    expect(life).toBeGreaterThan(280_000);
    expect(life).toBeLessThanOrEqual(300_000);
    // nothing is created by signing
    expect(storage.objects.size).toBe(0);
  });

  it('needs a token', async () => {
    const http = await start();
    await http.post('/v1/me/uploads').send({}).expect(401);
  });

  it.each([
    ['an unknown key', { purpose: 'avatar', contentType: 'image/png', size: 10, extra: 1 }],
    ['an unknown purpose', { purpose: 'banner', contentType: 'image/png', size: 10 }],
    ['svg', { purpose: 'avatar', contentType: 'image/svg+xml', size: 10 }],
    ['html', { purpose: 'attachment', contentType: 'text/html', size: 10, projectId: 'x' }],
    ['a pdf avatar', { purpose: 'avatar', contentType: 'application/pdf', size: 10 }],
    ['a pdf hero', { purpose: 'hero', contentType: 'application/pdf', size: 10, projectId: 'x' }],
    ['size 0', { purpose: 'avatar', contentType: 'image/png', size: 0 }],
    ['a fractional size', { purpose: 'avatar', contentType: 'image/png', size: 1.5 }],
    ['an image over the limit', { purpose: 'avatar', contentType: 'image/png', size: 5_000_001 }],
    [
      'an avatar with a project',
      { purpose: 'avatar', contentType: 'image/png', size: 10, projectId: 'x' },
    ],
    ['a hero without a project', { purpose: 'hero', contentType: 'image/png', size: 10 }],
    [
      'an attachment without a project',
      { purpose: 'attachment', contentType: 'image/png', size: 10 },
    ],
  ])('refuses %s with 400', async (_name, body) => {
    const http = await start();
    const me = await member('me');
    await http.post('/v1/me/uploads').set(me.auth).send(body).expect(400);
  });

  it('allows a PDF up to its own, larger limit, and only as an attachment', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const send = (size: number) =>
      http.post('/v1/me/uploads').set(me.auth).send({
        purpose: 'attachment',
        contentType: 'application/pdf',
        size,
        projectId: project.id,
      });
    await send(20_000_000).expect(201);
    await send(20_000_001).expect(400);
  });

  it('answers 404 for a project that is not the caller’s, and signs nothing', async () => {
    const http = await start();
    const me = await member('me');
    const other = await member('other');
    const { project } = await createProject(db, other.user);
    const stranger = await http
      .post('/v1/me/uploads')
      .set(me.auth)
      .send({ purpose: 'hero', contentType: 'image/png', size: 10, projectId: project.id })
      .expect(404);
    const missing = await http
      .post('/v1/me/uploads')
      .set(me.auth)
      .send({ purpose: 'hero', contentType: 'image/png', size: 10, projectId: newId() })
      .expect(404);
    expect(stranger.body).toEqual(missing.body);
  });

  it('answers 503 when the server has no bucket', async () => {
    const http = await start({}, false);
    const me = await member('me');
    const res = await http
      .post('/v1/me/uploads')
      .set(me.auth)
      .send({ purpose: 'avatar', contentType: 'image/png', size: 10 })
      .expect(503);
    expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('counts the objects under the prefix: signing reserves nothing, the cap is on what exists', async () => {
    const http = await start({ UPLOAD_MAX_FILES_PER_USER: '3' });
    const me = await member('cap');
    const other = await member('other');
    const sign = () =>
      http
        .post('/v1/me/uploads')
        .set(me.auth)
        .send({ purpose: 'avatar', contentType: 'image/png', size: 10 });
    const put = (n: number, user: Who) =>
      storage.put(`u/${user.user.id}/f${n}.png`, PNG, 'image/png');

    put(1, me);
    put(2, me);
    for (let i = 0; i < 3; i++) await sign().expect(201); // 2 exist, cap 3: signing does not use a slot
    expect(storage.objects.size).toBe(2);
    put(3, me); // an upload that was never registered still counts
    const full = await sign().expect(409);
    expect(full.body.code).toBe('LIMIT_REACHED');
    // another user's objects are not ours
    put(4, other);
    put(5, other);
    put(6, other);
    await http
      .post('/v1/me/uploads')
      .set(other.auth)
      .send({ purpose: 'avatar', contentType: 'image/png', size: 10 })
      .expect(409);
    // the sweep (or any delete) frees a slot
    await storage.delete(`u/${me.user.id}/f3.png`);
    await sign().expect(201);
  });

  it('has its own rate budget: exhausting it leaves other routes alone', async () => {
    const http = await start({ RATE_LIMIT_UPLOAD: '2', RATE_LIMIT_DEFAULT: '50' });
    const me = await member('rl');
    const sign = () =>
      http
        .post('/v1/me/uploads')
        .set(me.auth)
        .send({ purpose: 'avatar', contentType: 'image/png', size: 10 });
    expect((await sign()).status).toBe(201);
    expect((await sign()).status).toBe(201);
    expect((await sign()).status).toBe(429);
    await http.get('/v1/me').set(me.auth).expect(200);
  });
});

describe('a signed upload writes its key once', () => {
  it('refuses a replay of the URL after the object exists: registered bytes cannot be replaced', async () => {
    const http = await start();
    const me = await member('me');
    const { fileUrl, key, ticket } = await upload(http, me, 'avatar');
    await http.patch('/v1/me/profile').set(me.auth).send({ avatarUrl: fileUrl }).expect(200);
    const before = await storage.stat(key);

    // the same URL, same headers, different bytes of the same length
    const evil = Buffer.from(PNG);
    evil[evil.length - 1] = 0x58;
    expect(storage.putSigned(ticket, evil)).toBe(412);
    expect(storage.objects.get(key)?.body.equals(PNG)).toBe(true);
    expect(await storage.stat(key)).toEqual(before);
  });

  it('refuses to register bytes that were replaced after they were validated', async () => {
    const http = await start();
    const me = await member('me');
    const { fileUrl, key } = await upload(http, me, 'avatar');
    // between accept()'s read of the object and its claim, the bytes are replaced
    storage.afterStat = () => {
      storage.put(key, Buffer.concat([PNG, Buffer.from('swapped')]), 'image/png');
      return Promise.resolve();
    };
    const res = await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ avatarUrl: fileUrl })
      .expect(400);
    expect(res.body.code).toBe('FILE_IN_USE');
    expect(await avatarOf(me.user.id)).toBeNull();
    expect((await storage.stat(key))?.claimed).toBe(false);
  });
});

describe('registering an uploaded file on write', () => {
  it('avatar: PATCH /me/profile takes the file, GET shows a signed read URL, the old object goes', async () => {
    const http = await start();
    const me = await member('me');
    const first = await upload(http, me, 'avatar');
    const res = await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ avatarUrl: first.fileUrl })
      .expect(200);
    expect(await avatarOf(me.user.id)).toBe(first.fileUrl);
    expect(res.body.avatarUrl).toContain('X-Goog-Signature=read-');
    expect(res.body.avatarUrl).toContain(first.key);
    expect((await http.get('/v1/me').set(me.auth).expect(200)).body.avatarUrl).toContain(first.key);
    expect(storage.objects.get(first.key)).toBeDefined();

    // replacing deletes the old object after the row changed
    const second = await upload(http, me, 'avatar');
    await http.patch('/v1/me/profile').set(me.auth).send({ avatarUrl: second.fileUrl }).expect(200);
    expect(await avatarOf(me.user.id)).toBe(second.fileUrl);
    expect(storage.deleted).toEqual([first.key]);

    // clearing deletes it too
    await http.patch('/v1/me/profile').set(me.auth).send({ avatarUrl: null }).expect(200);
    expect(await avatarOf(me.user.id)).toBeNull();
    expect(storage.deleted).toEqual([first.key, second.key]);
  });

  it('sending the signed URL back is the same file: no new claim, nothing deleted', async () => {
    const http = await start();
    const me = await member('me');
    const { fileUrl, key } = await upload(http, me, 'avatar');
    const set = await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ avatarUrl: fileUrl })
      .expect(200);
    const signed = set.body.avatarUrl as string;
    expect(signed).not.toBe(fileUrl);
    await http.patch('/v1/me/profile').set(me.auth).send({ avatarUrl: signed }).expect(200);
    expect(await avatarOf(me.user.id)).toBe(fileUrl);
    expect(storage.deleted).toEqual([]);
    expect(storage.objects.has(key)).toBe(true);
  });

  it('keeps an external avatar URL as it is, and never signs it', async () => {
    const http = await start();
    const me = await member('me');
    const res = await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ avatarUrl: 'https://lh3.googleusercontent.com/a/x' })
      .expect(200);
    expect(res.body.avatarUrl).toBe('https://lh3.googleusercontent.com/a/x');
    expect(storage.signedReads).toEqual([]);
  });

  it('refuses an object that does not exist', async () => {
    const http = await start();
    const me = await member('me');
    const res = await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ avatarUrl: `https://${BUCKET}.storage.googleapis.com/u/${me.user.id}/nothing.png` })
      .expect(400);
    expect(res.body.code).toBe('INVALID_FILE');
    expect(await avatarOf(me.user.id)).toBeNull();
  });

  it('refuses another user’s file, however the URL is written, and leaves it unclaimed', async () => {
    const http = await start();
    const me = await member('me');
    const other = await member('other');
    const theirs = await upload(http, other, 'avatar');
    for (const url of [
      theirs.fileUrl,
      `${theirs.fileUrl}?X-Goog-Signature=zz`,
      `https://storage.googleapis.com/${BUCKET}/${theirs.key}`,
      `https://${BUCKET}.storage.googleapis.com/u/${me.user.id}/../${other.user.id}/${theirs.key.split('/')[2]}`,
    ]) {
      const res = await http
        .patch('/v1/me/profile')
        .set(me.auth)
        .send({ avatarUrl: url })
        .expect(400);
      expect(res.body.code).toBe('INVALID_FILE');
    }
    expect(await avatarOf(me.user.id)).toBeNull();
    expect((await storage.stat(theirs.key))?.claimed).toBe(false);
    // the real owner can still register it
    await http
      .patch('/v1/me/profile')
      .set(other.auth)
      .send({ avatarUrl: theirs.fileUrl })
      .expect(200);
  });

  it.each([
    ['HTML bytes under an image type', HTML_AS_PNG, 'image/png'],
    ['a PDF as an avatar', PDF, 'application/pdf'],
    ['an empty file', Buffer.alloc(0), 'image/png'],
  ])('refuses %s', async (_name, body, contentType) => {
    const http = await start();
    const me = await member('me');
    const key = `u/${me.user.id}/x.png`;
    storage.put(key, body, contentType);
    const res = await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ avatarUrl: `https://${BUCKET}.storage.googleapis.com/${key}` })
      .expect(400);
    expect(res.body.code).toBe('INVALID_FILE');
    expect((await storage.stat(key))?.claimed).toBe(false);
  });

  it('refuses a file larger than its limit even if the signature was bypassed', async () => {
    const http = await start({ UPLOAD_MAX_IMAGE_BYTES: '2048' });
    const me = await member('me');
    const key = `u/${me.user.id}/big.png`;
    storage.put(key, Buffer.concat([PNG, Buffer.alloc(4096)]), 'image/png');
    await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ avatarUrl: `https://${BUCKET}.storage.googleapis.com/${key}` })
      .expect(400);
  });

  it('registers a key once, ever: two at once give one winner; after a release it cannot come back', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const { project: other } = await createProject(db, me.user);
    const { fileUrl, key } = await upload(http, me, 'hero', { projectId: project.id });

    // Both requests read the object as unclaimed before either claims it: only the
    // claim's precondition decides the winner.
    let arrived = 0;
    let release!: () => void;
    const together = new Promise<void>((resolve) => (release = resolve));
    storage.afterStat = async () => {
      if (++arrived === 2) release();
      await together;
    };
    const set = (id: string) =>
      http.patch(`/v1/projects/${id}`).set(me.auth).send({ heroImageUrl: fileUrl });
    const results = await Promise.all([set(project.id), set(other.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const loser = results.find((r) => r.status === 400)!;
    expect(loser.body.code).toBe('FILE_IN_USE');
    storage.afterStat = undefined;
    const winnerId = results.find((r) => r.status === 200)!.body.id as string;

    // clearing the hero deletes the object; the same URL cannot be registered again
    await http
      .patch(`/v1/projects/${winnerId}`)
      .set(me.auth)
      .send({ heroImageUrl: null })
      .expect(200);
    expect(storage.deleted).toEqual([key]);
    const again = await set(winnerId).expect(400);
    expect(again.body.code).toBe('INVALID_FILE');
    expect((await rowOf(winnerId))?.heroImageUrl).toBeNull();
  });

  it('a file registered once cannot be registered again as something else', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const { fileUrl } = await upload(http, me, 'hero', { projectId: project.id });
    await http
      .patch(`/v1/projects/${project.id}`)
      .set(me.auth)
      .send({ heroImageUrl: fileUrl })
      .expect(200);
    const res = await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ avatarUrl: fileUrl })
      .expect(400);
    expect(res.body.code).toBe('FILE_IN_USE');
  });

  it('hero on create: registered, stored canonical, returned signed', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const { fileUrl, key } = await upload(http, me, 'hero', { projectId: project.id });
    const res = await http
      .post('/v1/projects')
      .set(me.auth)
      .send({ title: 'T', heroImageUrl: fileUrl })
      .expect(201);
    expect((await rowOf(res.body.id as string))?.heroImageUrl).toBe(fileUrl);
    expect(res.body.heroImageUrl).toContain('X-Goog-Signature=read-');
    expect((await storage.stat(key))?.claimed).toBe(true);
  });

  it('a hero that is another user’s uploaded file is refused', async () => {
    const http = await start();
    const me = await member('me');
    const other = await member('other');
    const { project: theirs } = await createProject(db, other.user);
    const { fileUrl } = await upload(http, other, 'hero', { projectId: theirs.id });
    await http
      .post('/v1/projects')
      .set(me.auth)
      .send({ title: 'T', heroImageUrl: fileUrl })
      .expect(400);
  });
});

describe('signed reads', () => {
  it('shows signed URLs for uploaded files and leaves external ones alone, one URL per file while cached', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user, {
      heroImageUrl: 'https://img.example/h.png',
    });
    const { fileUrl, key } = await upload(http, me, 'hero', { projectId: project.id });
    await http
      .patch(`/v1/projects/${project.id}`)
      .set(me.auth)
      .send({ heroImageUrl: fileUrl })
      .expect(200);

    const a = await http.get(`/v1/projects/${project.id}`).expect(200);
    const b = await http.get(`/v1/projects/${project.id}`).expect(200);
    expect(a.body.heroImageUrl).toContain(key);
    expect(a.body.heroImageUrl).toBe(b.body.heroImageUrl);
    expect(storage.signedReads.filter((k) => k === key)).toHaveLength(1);

    const list = await http.get(`/v1/users/${me.user.id}/projects`).expect(200);
    expect(list.body.items[0].heroImageUrl).toBe(a.body.heroImageUrl);
    const profile = await http.get(`/v1/users/${me.user.id}`).expect(200);
    expect(profile.body.projects[0].heroImageUrl).toBe(a.body.heroImageUrl);
  });

  it('issues no read URL to anyone who cannot read the project', async () => {
    const http = await start();
    const me = await member('me');
    const other = await member('other');
    const { project } = await createProject(db, me.user);
    const { fileUrl, key } = await upload(http, me, 'hero', { projectId: project.id });
    await http
      .patch(`/v1/projects/${project.id}`)
      .set(me.auth)
      .send({ heroImageUrl: fileUrl, isPublic: false })
      .expect(200);

    // the owner's own response signed it once; from here on only the owner gets one
    const signedSoFar = storage.signedReads.length;
    await http.get(`/v1/projects/${project.id}`).expect(404);
    await http.get(`/v1/projects/${project.id}`).set(other.auth).expect(404);
    const listed = await http.get(`/v1/users/${me.user.id}/projects`).expect(200);
    expect(listed.body.items).toEqual([]);
    expect(storage.signedReads).toHaveLength(signedSoFar);

    const mine = await http.get(`/v1/projects/${project.id}`).set(me.auth).expect(200);
    expect(mine.body.heroImageUrl).toContain(key);
  });

  it('never signs a URL that was not registered: another user’s object in a link field stays plain', async () => {
    const http = await start();
    const me = await member('me');
    const other = await member('other');
    const { fileUrl } = await upload(http, other, 'avatar');
    const res = await http
      .post('/v1/projects')
      .set(me.auth)
      .send({ title: 'T', liveDemoUrl: fileUrl, links: [{ label: 'x', url: fileUrl }] })
      .expect(201);
    expect(res.body.liveDemoUrl).toBe(fileUrl);
    expect(res.body.links[0].url).toBe(fileUrl);
    expect(storage.signedReads).toEqual([]);
  });
});

describe('deleting objects with their rows', () => {
  it('deleting a project deletes its hero and attachment objects, after the commit', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const hero = await upload(http, me, 'hero', { projectId: project.id });
    const img = await upload(http, me, 'attachment', { projectId: project.id });
    const pdf = await upload(http, me, 'attachment', {
      projectId: project.id,
      body: PDF,
      contentType: 'application/pdf',
    });
    await http
      .patch(`/v1/projects/${project.id}`)
      .set(me.auth)
      .send({ heroImageUrl: hero.fileUrl })
      .expect(200);
    await http
      .post(`/v1/projects/${project.id}/attachments`)
      .set(me.auth)
      .send({ type: 'image', url: img.fileUrl })
      .expect(201);
    await http
      .post(`/v1/projects/${project.id}/attachments`)
      .set(me.auth)
      .send({ type: 'pdf', url: pdf.fileUrl, title: 'R' })
      .expect(201);
    await http
      .post(`/v1/projects/${project.id}/attachments`)
      .set(me.auth)
      .send({ type: 'link', url: 'https://a.example' })
      .expect(201);

    await http.delete(`/v1/projects/${project.id}`).set(me.auth).expect(204);
    expect(await rowOf(project.id)).toBeUndefined();
    expect([...storage.deleted].sort()).toEqual([hero.key, img.key, pdf.key].sort());
    expect(storage.objects.size).toBe(0);
  });

  it('deletes nothing when the project is not the caller’s', async () => {
    const http = await start();
    const me = await member('me');
    const intruder = await member('intruder');
    const { project } = await createProject(db, me.user);
    const hero = await upload(http, me, 'hero', { projectId: project.id });
    await http
      .patch(`/v1/projects/${project.id}`)
      .set(me.auth)
      .send({ heroImageUrl: hero.fileUrl })
      .expect(200);
    await http.delete(`/v1/projects/${project.id}`).set(intruder.auth).expect(404);
    expect(storage.deleted).toEqual([]);
    expect(storage.objects.has(hero.key)).toBe(true);
  });

  it('a failed object delete is logged with its key and does not fail the request', async () => {
    const http = await start();
    const me = await member('me');
    const { project } = await createProject(db, me.user);
    const hero = await upload(http, me, 'hero', { projectId: project.id });
    await http
      .patch(`/v1/projects/${project.id}`)
      .set(me.auth)
      .send({ heroImageUrl: hero.fileUrl })
      .expect(200);
    storage.failDelete.add(hero.key);
    await http.delete(`/v1/projects/${project.id}`).set(me.auth).expect(204);
    expect(await rowOf(project.id)).toBeUndefined();
    const line = logs.lines().find((l) => l.msg === 'storage object delete failed');
    expect(line).toMatchObject({ key: hero.key });
  });

  it('deleting the account deletes every object under the prefix, registered or not, and only those', async () => {
    const http = await start();
    const me = await member('me');
    const other = await member('other');
    const registered = await upload(http, me, 'avatar');
    await http
      .patch('/v1/me/profile')
      .set(me.auth)
      .send({ avatarUrl: registered.fileUrl })
      .expect(200);
    const abandoned = await upload(http, me, 'avatar'); // signed, PUT, never registered
    const theirs = await upload(http, other, 'avatar');

    await http.delete('/v1/me').set(me.auth).expect(204);
    expect(storage.objects.has(registered.key)).toBe(false);
    expect(storage.objects.has(abandoned.key)).toBe(false);
    expect(storage.objects.has(theirs.key)).toBe(true);
  });

  it('account deletion still succeeds when the storage listing fails', async () => {
    const http = await start();
    const me = await member('me');
    storage.list = () => Promise.reject(new Error('storage down'));
    await http.delete('/v1/me').set(me.auth).expect(204);
    expect(
      logs.lines().some((l) => l.msg === 'storage listing after account deletion failed'),
    ).toBe(true);
  });
});
