import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { importKey } from '../../../core/storage/file-rules.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig, testDatabase } from '../../../testing/database.js';
import { createUser } from '../../../testing/factories.js';
import { FakeFileStorage } from '../../../testing/fake-storage.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { buildZip, type ZipEntrySpec } from '../../../testing/zip-builder.js';

/**
 * M7-T41: the LinkedIn export upload ticket and the preview. Storage is the in-memory fake
 * (a real PUT to the signed URL is proved by the M4 runs); the archives are built here with
 * the real LinkedIn headers and invented rows.
 */

const BUCKET = 'test-bucket';
let tenant: TestTenant;
let app: NestExpressApplication | undefined;
let storage: FakeFileStorage;
const logs = captureLogs();
const db = testDatabase();

const fixture = (name: string) =>
  readFileSync(new URL(`../../../testing/fixtures/linkedin/${name}`, import.meta.url));

const good = (): ZipEntrySpec[] => [
  { name: 'Positions.csv', data: fixture('Positions.csv') },
  { name: 'Education.csv', data: fixture('Education.csv'), method: 'deflate' },
  { name: 'Skills.csv', data: fixture('Skills.csv') },
  { name: 'Certifications.csv', data: fixture('Certifications.csv') },
  { name: 'Profile.csv', data: fixture('Profile.csv') },
  { name: 'Jobs/', noData: true },
  { name: 'Jobs/Job Applications.csv', data: 'x\n' },
  { name: 'messages.csv', data: 'x\n' },
];

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
      LOG_LEVEL: 'info',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
      RATE_LIMIT_LINKEDIN: '100',
      ...(withStorage ? { STORAGE_BUCKET: BUCKET } : {}),
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

type Http = Awaited<ReturnType<typeof start>>;
type Who = Awaited<ReturnType<typeof member>>;

const imports = (who: Who) => `imports/${who.user.id}/`;
const kept = (who: Who) => [...storage.objects.keys()].filter((k) => k.startsWith(imports(who)));

/** Ask for a ticket, then do the browser's PUT. Returns the upload id. */
async function upload(http: Http, who: Who, zip: Buffer): Promise<string> {
  const res = await http
    .post('/v1/me/imports/linkedin/uploads')
    .set(who.auth)
    .send({ size: zip.length })
    .expect(201);
  expect(storage.putSigned(res.body as never, zip)).toBe(200);
  return (res.body as { uploadId: string }).uploadId;
}

const preview = (http: Http, who: Who, uploadId: string) =>
  http.post('/v1/me/imports/linkedin/preview').set(who.auth).send({ uploadId });

describe('POST /v1/me/imports/linkedin/uploads', () => {
  it('signs one PUT: zip type, exact size pinned, a key under the caller’s imports prefix', async () => {
    const http = await start();
    const me = await member('me');
    const res = await http
      .post('/v1/me/imports/linkedin/uploads')
      .set(me.auth)
      .send({ size: 5000 })
      .expect(201);
    const body = res.body as {
      uploadId: string;
      uploadUrl: string;
      method: string;
      headers: Record<string, string>;
      expiresAt: string;
    };
    expect(body.method).toBe('PUT');
    expect(body.uploadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.headers['Content-Type']).toBe('application/zip');
    expect(body.headers['x-goog-content-length-range']).toBe('5000,5000');
    expect(body.headers['x-goog-if-generation-match']).toBe('0');
    expect(decodeURIComponent(new URL(body.uploadUrl).pathname.slice(1))).toBe(
      importKey(me.user.id, body.uploadId),
    );
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a size over the configured cap with IMPORT_TOO_LARGE, and a zero size', async () => {
    const http = await start({ IMPORT_MAX_ZIP_BYTES: '2048' });
    const me = await member('me');
    const big = await http
      .post('/v1/me/imports/linkedin/uploads')
      .set(me.auth)
      .send({ size: 2049 })
      .expect(413);
    expect(big.body.code).toBe('IMPORT_TOO_LARGE');
    await http.post('/v1/me/imports/linkedin/uploads').set(me.auth).send({ size: 0 }).expect(400);
    await http.post('/v1/me/imports/linkedin/uploads').set(me.auth).send({}).expect(400);
  });

  it('holds at most IMPORT_MAX_PENDING uploads per user; another user is unaffected', async () => {
    const http = await start({ IMPORT_MAX_PENDING: '2' });
    const me = await member('me');
    const other = await member('other');
    for (const n of [1, 2])
      storage.put(`${imports(me)}p${n}.zip`, Buffer.from('x'), 'application/zip');
    const full = await http
      .post('/v1/me/imports/linkedin/uploads')
      .set(me.auth)
      .send({ size: 100 })
      .expect(409);
    expect(full.body.code).toBe('LIMIT_REACHED');
    await http
      .post('/v1/me/imports/linkedin/uploads')
      .set(other.auth)
      .send({ size: 100 })
      .expect(201);
    await storage.delete(`${imports(me)}p1.zip`);
    await http.post('/v1/me/imports/linkedin/uploads').set(me.auth).send({ size: 100 }).expect(201);
  });

  it('counts tickets not yet uploaded: they cannot be collected past the cap', async () => {
    const http = await start({ IMPORT_MAX_PENDING: '2' });
    const me = await member('me');
    const other = await member('other');
    const ask = (who: Who) =>
      http.post('/v1/me/imports/linkedin/uploads').set(who.auth).send({ size: 100 });
    // concurrent requests see each other
    const results = await Promise.all([ask(me), ask(me), ask(me)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    expect((await ask(me)).status).toBe(409);
    expect((await ask(other)).status).toBe(201);
    // a ticket whose upload then arrives is counted once, not twice
    const ticket = results.find((r) => r.status === 201)!;
    expect(storage.putSigned(ticket.body as never, Buffer.alloc(100))).toBe(200);
    expect((await ask(me)).status).toBe(409);
    // a preview frees its slot
    await preview(http, me, (ticket.body as { uploadId: string }).uploadId);
    expect((await ask(me)).status).toBe(201);
  });

  it('answers 503 STORAGE_UNAVAILABLE without a bucket, and 401 without a token', async () => {
    const http = await start({}, false);
    const me = await member('me');
    const res = await http
      .post('/v1/me/imports/linkedin/uploads')
      .set(me.auth)
      .send({ size: 100 })
      .expect(503);
    expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
    await http.post('/v1/me/imports/linkedin/uploads').send({ size: 100 }).expect(401);
    await http.post('/v1/me/imports/linkedin/preview').send({ uploadId: randomUUID() }).expect(401);
  });

  it('has its own tighter budget: exhausting it leaves other routes alone', async () => {
    const http = await start({ RATE_LIMIT_LINKEDIN: '2', RATE_LIMIT_DEFAULT: '50' });
    const me = await member('rl');
    const ask = () => http.post('/v1/me/imports/linkedin/uploads').set(me.auth).send({ size: 100 });
    expect((await ask()).status).toBe(201);
    expect((await ask()).status).toBe(201);
    const limited = await ask();
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    // the preview has its own counter under the same limit value
    expect((await preview(http, me, randomUUID())).status).toBe(404);
    await http.get('/v1/me').set(me.auth).expect(200);
  });
});

describe('POST /v1/me/imports/linkedin/preview', () => {
  it('proposes entries from a real-shaped export, saves nothing, and deletes the upload', async () => {
    const http = await start();
    const me = await member('me');
    const id = await upload(http, me, buildZip(good()));
    const before = await db.selectFrom('experience').select('id').execute();

    const res = await preview(http, me, id).expect(200);
    const body = res.body;

    expect(body.experience).toHaveLength(5);
    expect(body.experience[0]).toMatchObject({
      status: 'new',
      fields: { title: 'Backend Developer', organization: 'Northwind Labs', start: '2022-09' },
      problems: [],
    });
    // a year-only date is a problem to fix in the preview, never an invented month
    expect(body.experience[2]).toMatchObject({
      status: 'invalid',
      problems: [{ field: 'start', code: 'DATE_NEEDS_MONTH' }],
    });
    // the export has no field of study: always for the student to fill
    expect(body.education[0].status).toBe('invalid');
    expect(body.education[0].problems).toContainEqual({ field: 'field', code: 'REQUIRED' });
    expect(body.certifications[0].status).toBe('new');
    expect(body.skills).toEqual([
      { name: 'TypeScript', status: 'new' },
      { name: 'SQL', status: 'new' },
      { name: 'Public Speaking', status: 'new' },
    ]);
    expect(body.missingFiles).toEqual([]);
    expect(body.skippedColumns).toEqual([]);
    // Profile.csv, a folder file and messages.csv: counted, never named
    expect(body.skippedFileCount).toBe(3);
    expect(body.extensions).toEqual({ '.csv': 3 });
    expect(JSON.stringify(body)).not.toMatch(/SENTINEL|Nowhere Street|Job Applications/);

    expect(await db.selectFrom('experience').select('id').execute()).toEqual(before);
    expect(await db.selectFrom('education').select('id').execute()).toEqual([]);
    expect(kept(me)).toEqual([]);
    expect(storage.deleted).toContain(importKey(me.user.id, id));
  });

  it('marks entries already on the profile (and repeats inside the file) as duplicates', async () => {
    const http = await start();
    const me = await member('me');
    await http
      .post('/v1/me/experience')
      .set(me.auth)
      .send({
        title: 'backend developer',
        organization: 'NORTHWIND LABS',
        start: '2022-09',
        end: null,
        summary: '',
      })
      .expect(201);
    await http
      .post('/v1/me/education')
      .set(me.auth)
      .send({
        institution: 'Example Technical University',
        degree: 'Bachelor of Science',
        field: 'Anything',
        startYear: 2019,
        endYear: 2023,
      })
      .expect(201);
    await http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: ['sql'] })
      .expect(200);

    const id = await upload(http, me, buildZip(good()));
    const body = (await preview(http, me, id).expect(200)).body;
    expect(body.experience[0]).toMatchObject({ status: 'duplicate', problems: [] });
    expect(body.education[0]).toMatchObject({ status: 'duplicate' });
    expect(body.skills).toEqual([
      { name: 'TypeScript', status: 'new' },
      { name: 'SQL', status: 'duplicate' },
      { name: 'Public Speaking', status: 'new' },
    ]);
  });

  it('is the caller’s alone: another user’s upload id finds nothing and is not touched', async () => {
    const http = await start();
    const me = await member('me');
    const other = await member('other');
    const id = await upload(http, me, buildZip(good()));

    const res = await preview(http, other, id).expect(404);
    expect(res.body.code).toBe('IMPORT_UPLOAD_MISSING');
    expect(kept(me)).toEqual([importKey(me.user.id, id)]);
    expect(storage.deleted).toEqual([]);

    await preview(http, me, randomUUID()).expect(404);
    await http
      .post('/v1/me/imports/linkedin/preview')
      .set(me.auth)
      .send({ uploadId: '../u/other/x' })
      .expect(400);
    await http
      .post('/v1/me/imports/linkedin/preview')
      .set(me.auth)
      .send({ uploadId: id, extra: 1 })
      .expect(400);
    await preview(http, me, id).expect(200);
  });

  it('a second preview of the same upload finds it gone', async () => {
    const http = await start();
    const me = await member('me');
    const id = await upload(http, me, buildZip(good()));
    await preview(http, me, id).expect(200);
    await preview(http, me, id).expect(404);
  });

  it('refuses an upload over the size cap, and deletes it', async () => {
    const http = await start({ IMPORT_MAX_ZIP_BYTES: '1024' });
    const me = await member('me');
    storage.put(
      importKey(me.user.id, 'a3b9c1d2-0000-4000-8000-000000000001'),
      Buffer.alloc(2000),
      'application/zip',
    );
    const res = await preview(http, me, 'a3b9c1d2-0000-4000-8000-000000000001').expect(413);
    expect(res.body.code).toBe('IMPORT_TOO_LARGE');
    expect(kept(me)).toEqual([]);
  });

  const bomb = Buffer.alloc(3_000_000, 'A');
  const corpus: [string, () => Buffer, number, string, Record<string, string>?][] = [
    ['not a zip', () => Buffer.from('definitely not a zip file'), 422, 'IMPORT_NOT_ZIP'],
    ['one stray byte', () => Buffer.from('P'), 422, 'IMPORT_NOT_ZIP'],
    ['empty archive', () => buildZip([]), 422, 'IMPORT_EMPTY'],
    [
      'only unrelated files',
      () => buildZip([{ name: 'messages.csv', data: 'x\n' }]),
      422,
      'IMPORT_EMPTY',
    ],
    [
      'too many entries',
      () => buildZip(Array.from({ length: 13 }, (_, i) => ({ name: `f${i}.txt`, data: 'x' }))),
      422,
      'IMPORT_TOO_MANY_ENTRIES',
    ],
    [
      'zip bomb',
      () => buildZip([...good(), { name: 'Rich_Media.bin', data: bomb, method: 'deflate' }]),
      422,
      'IMPORT_RATIO_EXCEEDED',
    ],
    [
      'declared sizes past the total',
      () =>
        buildZip([
          ...good(),
          {
            name: 'a.bin',
            noData: true,
            declaredSize: 400_000_000,
            declaredCompressed: 400_000_000,
          },
          {
            name: 'b.bin',
            noData: true,
            declaredSize: 400_000_000,
            declaredCompressed: 400_000_000,
          },
        ]),
      422,
      'IMPORT_UNCOMPRESSED_TOO_LARGE',
    ],
    [
      'an entry that lies about its size',
      () =>
        buildZip([
          {
            name: 'Skills.csv',
            data: 'Name\n' + 'skill\n'.repeat(500),
            declaredSize: 12,
            method: 'deflate',
          },
        ]),
      422,
      'IMPORT_UNCOMPRESSED_TOO_LARGE',
    ],
    [
      'path traversal',
      () => buildZip([...good(), { name: '../../evil.csv', data: 'x' }]),
      422,
      'IMPORT_UNSAFE_PATH',
    ],
    [
      'traversal inside a subfolder',
      () => buildZip([...good(), { name: 'Jobs/../../evil.csv', data: 'x' }]),
      422,
      'IMPORT_UNSAFE_PATH',
    ],
    [
      'absolute path',
      () => buildZip([...good(), { name: '/etc/passwd', data: 'x' }]),
      422,
      'IMPORT_UNSAFE_PATH',
    ],
    [
      'backslash path',
      () => buildZip([...good(), { name: '..\\evil.csv', data: 'x' }]),
      422,
      'IMPORT_UNSAFE_PATH',
    ],
    [
      'encrypted entry',
      () =>
        buildZip([
          ...good(),
          { name: 'secret.bin', data: 'x', encrypted: true, declaredCompressed: 13 },
        ]),
      422,
      'IMPORT_ENCRYPTED',
    ],
    [
      'a dataset that is not a csv',
      () => buildZip([...good(), { name: 'Positions.xlsx', data: 'x' }]),
      422,
      'IMPORT_ENTRY_NOT_CSV',
    ],
    [
      'a dataset twice',
      () => buildZip([...good(), { name: 'Skills.csv', data: fixture('Skills.csv') }]),
      422,
      'IMPORT_DUPLICATE_ENTRY',
    ],
    [
      'wrong columns',
      () => buildZip([{ name: 'Positions.csv', data: 'Title,Location\nDev,Home\n' }]),
      422,
      'IMPORT_COLUMNS_MISSING',
    ],
    [
      'another interface language',
      () =>
        buildZip([
          { name: 'Positions.csv', data: 'Название компании,Должность\nАкме,Разработчик\n' },
        ]),
      422,
      'IMPORT_LANGUAGE_UNRECOGNISED',
    ],
    [
      'damaged csv',
      () => buildZip([{ name: 'Skills.csv', data: 'Name\n"open\n' }]),
      422,
      'IMPORT_MALFORMED_CSV',
    ],
  ];

  it.each(corpus)(
    'corpus: %s -> one stable code, and nothing is left in the bucket',
    async (_label, zip, status, code) => {
      const http = await start({
        IMPORT_MAX_ENTRIES: '12',
        IMPORT_MAX_UNCOMPRESSED_BYTES: '500000000',
      });
      const me = await member('me');
      const bytes = zip();
      const id = await upload(http, me, bytes);
      const res = await preview(http, me, id).expect(status);
      expect(res.body.code).toBe(code);
      expect(kept(me)).toEqual([]);
      expect(storage.deleted).toContain(importKey(me.user.id, id));
      // the refusal quotes nothing from the archive
      expect(JSON.stringify(res.body)).not.toMatch(/evil|etc\/passwd|secret\.bin|skill|Акме/);
    },
  );

  it('names the missing columns for a known header', async () => {
    const http = await start();
    const me = await member('me');
    const id = await upload(
      http,
      me,
      buildZip([{ name: 'Positions.csv', data: 'Title,Location\nDev,Home\n' }]),
    );
    const res = await preview(http, me, id).expect(422);
    expect(res.body.details).toEqual({
      file: 'Positions.csv',
      columns: ['Company Name', 'Started On'],
    });
  });

  it('refuses a bomb from the central directory: almost none of it is read', async () => {
    const http = await start();
    const me = await member('me');
    const zip = buildZip([
      ...good(),
      { name: 'Rich_Media.bin', data: Buffer.alloc(3_000_000, 'A'), method: 'deflate' },
    ]);
    const id = await upload(http, me, zip);
    await preview(http, me, id).expect(422);
    expect(storage.rangeBytes).toBeLessThan(zip.length * 2);
  });

  it('answers 429 IMPORT_BUSY while IMPORT_MAX_CONCURRENT previews run, and keeps the waiting upload', async () => {
    const http = await start({ IMPORT_MAX_CONCURRENT: '1' });
    const me = await member('me');
    const first = await upload(http, me, buildZip(good()));
    const second = await upload(http, me, buildZip(good()));

    let release!: () => void;
    storage.rangeGate = new Promise<void>((r) => (release = r));
    const running = preview(http, me, first).then((r) => r);
    // barrier: the first preview is inside its first ranged read
    while (storage.rangeReads === 0) await new Promise((r) => setImmediate(r));

    const busy = await preview(http, me, second).expect(429);
    expect(busy.body.code).toBe('IMPORT_BUSY');
    expect(busy.headers['retry-after']).toBe('5');
    expect(kept(me)).toContain(importKey(me.user.id, second));

    storage.rangeGate = undefined;
    release();
    expect((await running).status).toBe(200);
    await preview(http, me, second).expect(200);
  });

  it('a storage failure while reading is a 500, not a bad archive, and the object is still deleted', async () => {
    const http = await start();
    const me = await member('me');
    const id = await upload(http, me, buildZip(good()));
    storage.failRangeAfter = 1;
    const res = await preview(http, me, id);
    expect(res.status).toBe(500);
    expect(res.body.code).not.toMatch(/^IMPORT_/);
    expect(kept(me)).toEqual([]);
  });

  it('a failed delete is logged and does not fail the preview', async () => {
    const http = await start();
    const me = await member('me');
    const id = await upload(http, me, buildZip(good()));
    storage.failDelete.add(importKey(me.user.id, id));
    await preview(http, me, id).expect(200);
    expect(logs.text()).toContain('linkedin import upload delete failed');
    expect(kept(me)).toEqual([importKey(me.user.id, id)]);
  });

  it('logs the outcome code and nothing from the archive', async () => {
    const http = await start();
    const me = await member('me');
    const id = await upload(
      http,
      me,
      buildZip([...good(), { name: '../Jane Q Contact/addresses.csv', data: 'x' }]),
    );
    await preview(http, me, id).expect(422);
    const text = logs.text();
    expect(text).toContain('IMPORT_UNSAFE_PATH');
    expect(text).not.toMatch(/Jane|addresses|Northwind|Backend Developer/);
  });
});
