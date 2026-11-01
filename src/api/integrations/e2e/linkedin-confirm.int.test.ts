import { readFileSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createConnection } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testConfig, testDatabase, testDatabaseUrl } from '../../../testing/database.js';
import { createUser } from '../../../testing/factories.js';
import { FakeFileStorage } from '../../../testing/fake-storage.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { buildZip } from '../../../testing/zip-builder.js';

/**
 * M7-T42: LinkedIn confirm. Stateless; one transaction under the user lock; deduplicated on
 * the natural keys; validated like a manual entry; the cap rolls everything back.
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();
const db = testDatabase();
const storage = new FakeFileStorage('test-bucket');

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
      STORAGE_BUCKET: 'test-bucket',
      RATE_LIMIT_LINKEDIN: '100',
      RATE_LIMIT_INTEGRATION: '100',
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

const exp = (over: Record<string, unknown> = {}) => ({
  title: 'Developer',
  organization: 'Example Co',
  start: '2022-09',
  end: '2024-06',
  summary: 'Built things',
  achievements: [],
  skills: [],
  ...over,
});
const edu = (over: Record<string, unknown> = {}) => ({
  institution: 'Example University',
  degree: 'BSc',
  field: 'Computer Science',
  startYear: 2019,
  endYear: 2023,
  description: null,
  highlights: [],
  ...over,
});
const cert = (over: Record<string, unknown> = {}) => ({
  name: 'Cloud Basics',
  issuer: 'Example Cloud',
  date: '2023-03',
  credentialUrl: null,
  ...over,
});
const body = (over: Record<string, unknown> = {}) => ({
  experience: [],
  education: [],
  certifications: [],
  skills: [],
  ...over,
});

const confirm = (http: Http, who: Who, payload: unknown) =>
  http
    .post('/v1/me/imports/linkedin/confirm')
    .set(who.auth)
    .send(payload as object);

async function counts(who: Who) {
  const n = async (table: 'experience' | 'education' | 'certifications' | 'userSkills') =>
    (await db.selectFrom(table).select('userId').where('userId', '=', who.user.id).execute())
      .length;
  const synced = await db
    .selectFrom('integrations')
    .select('lastSyncedAt')
    .where('userId', '=', who.user.id)
    .where('integrationType', '=', 'linkedin')
    .executeTakeFirst();
  return {
    experience: await n('experience'),
    education: await n('education'),
    certifications: await n('certifications'),
    skills: await n('userSkills'),
    synced: synced?.lastSyncedAt ?? null,
  };
}

const NOTHING = { experience: 0, education: 0, certifications: 0, skills: 0, synced: null };

describe('POST /v1/me/imports/linkedin/confirm', () => {
  it('saves the selected items; a second identical confirm adds nothing', async () => {
    const http = await start();
    const me = await member('me');
    const payload = body({
      experience: [exp(), exp({ title: 'Intern', start: '2021-06', end: '2021-08' })],
      education: [edu()],
      certifications: [cert()],
      skills: ['TypeScript', 'SQL'],
    });

    const first = await confirm(http, me, payload).expect(200);
    expect(first.body).toEqual({
      added: { experience: 2, education: 1, certifications: 1, skills: 2 },
      skipped: { experience: 0, education: 0, certifications: 0, skills: 0 },
    });
    const stored = await counts(me);
    expect(stored).toMatchObject({ experience: 2, education: 1, certifications: 1, skills: 2 });
    expect(stored.synced).toBeInstanceOf(Date);

    const second = await confirm(http, me, payload).expect(200);
    expect(second.body).toEqual({
      added: { experience: 0, education: 0, certifications: 0, skills: 0 },
      skipped: { experience: 2, education: 1, certifications: 1, skills: 2 },
    });
    expect(await counts(me)).toMatchObject({
      experience: 2,
      education: 1,
      certifications: 1,
      skills: 2,
    });
  });

  it('keeps the file’s order (first item first) and the existing skills’ order', async () => {
    const http = await start();
    const me = await member('me');
    await http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: ['Go', 'Rust'] })
      .expect(200);
    await confirm(
      http,
      me,
      body({
        experience: [
          exp({ title: 'Newest', start: '2024-01', end: null }),
          exp({ title: 'Older', start: '2020-01', end: '2021-01' }),
        ],
        skills: ['Zig', 'go', 'Elixir'],
      }),
    ).expect(200);
    const rows = await db
      .selectFrom('experience')
      .select('title')
      .where('userId', '=', me.user.id)
      .orderBy('sortOrder')
      .execute();
    expect(rows.map((e) => e.title)).toEqual(['Newest', 'Older']);
    const skills = await db
      .selectFrom('userSkills')
      .select('skillName')
      .where('userId', '=', me.user.id)
      .orderBy('sortOrder')
      .execute();
    expect(skills.map((r) => r.skillName)).toEqual(['Go', 'Rust', 'Zig', 'Elixir']);
  });

  it('skips entries already on the profile (any case or spacing) and repeats inside the request', async () => {
    const http = await start();
    const me = await member('me');
    await http.post('/v1/me/experience').set(me.auth).send(exp()).expect(201);
    await http
      .post('/v1/me/education')
      .set(me.auth)
      .send(edu({ field: 'Other field' }))
      .expect(201);
    await http.post('/v1/me/certifications').set(me.auth).send(cert()).expect(201);
    await http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: ['typescript'] })
      .expect(200);

    const res = await confirm(
      http,
      me,
      body({
        experience: [
          exp({ title: '  developer ', organization: 'EXAMPLE  CO' }),
          exp({ title: 'Different' }),
          exp({ title: 'Different' }),
        ],
        education: [edu({ institution: 'example university', degree: 'bsc' })],
        certifications: [cert({ name: 'CLOUD BASICS' })],
        skills: ['TypeScript', 'SQL', 'sql'],
      }),
    ).expect(200);
    expect(res.body).toEqual({
      added: { experience: 1, education: 0, certifications: 0, skills: 1 },
      skipped: { experience: 2, education: 1, certifications: 1, skills: 2 },
    });
  });

  it('a different date or issuer is a different entry', async () => {
    const http = await start();
    const me = await member('me');
    await confirm(http, me, body({ experience: [exp()], certifications: [cert()] })).expect(200);
    const res = await confirm(
      http,
      me,
      body({
        experience: [exp({ start: '2022-10' })],
        certifications: [cert({ issuer: 'Another' })],
      }),
    ).expect(200);
    expect(res.body.added).toMatchObject({ experience: 1, certifications: 1 });
  });

  it('never overwrites an edited entry: a matching key leaves the stored fields alone', async () => {
    const http = await start();
    const me = await member('me');
    const made = await http
      .post('/v1/me/experience')
      .set(me.auth)
      .send(exp({ summary: 'mine' }))
      .expect(201);
    await confirm(http, me, body({ experience: [exp({ summary: 'from LinkedIn' })] })).expect(200);
    const rows = await db
      .selectFrom('experience')
      .select(['id', 'summary'])
      .where('userId', '=', me.user.id)
      .execute();
    expect(rows).toEqual([{ id: made.body.id, summary: 'mine' }]);
  });

  it('an empty selection changes nothing but the sync time', async () => {
    const http = await start();
    const me = await member('me');
    const res = await confirm(http, me, body()).expect(200);
    expect(res.body.added).toEqual({ experience: 0, education: 0, certifications: 0, skills: 0 });
    expect((await counts(me)).synced).toBeInstanceOf(Date);
    const status = await http.get('/v1/me/integrations').set(me.auth).expect(200);
    expect(status.body.linkedin.lastSyncedAt).not.toBeNull();

    // a later confirm moves the time forward on the same row
    await db
      .updateTable('integrations')
      .set({ lastSyncedAt: new Date('2020-01-01T00:00:00Z') })
      .where('userId', '=', me.user.id)
      .execute();
    await confirm(http, me, body()).expect(200);
    const rows = await db
      .selectFrom('integrations')
      .select('lastSyncedAt')
      .where('userId', '=', me.user.id)
      .where('integrationType', '=', 'linkedin')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastSyncedAt?.getFullYear()).toBeGreaterThan(2020);
  });

  it('refuses a malformed item with a 400 naming it, and writes nothing', async () => {
    const http = await start();
    const me = await member('me');
    const cases: [string, unknown][] = [
      ['an item with no title', body({ experience: [exp(), { ...exp(), title: '' }] })],
      ['an unknown key', body({ experience: [{ ...exp(), id: 'x' }] })],
      ['a month that is not YYYY-MM', body({ experience: [exp({ start: 'Sep 2022' })] })],
      [
        'an end before the start',
        body({ experience: [exp({ start: '2024-01', end: '2023-01' })] }),
      ],
      ['education without a field', body({ education: [edu({ field: '' })] })],
      [
        'a javascript: credential URL',
        body({ certifications: [cert({ credentialUrl: 'javascript:alert(1)' })] }),
      ],
      ['a title over the column', body({ experience: [exp({ title: 'x'.repeat(501) })] })],
      ['an empty skill', body({ skills: ['ok', '  '] })],
      ['a missing section', { experience: [] }],
    ];
    for (const [label, payload] of cases) {
      const res = await confirm(http, me, payload);
      expect(res.status, label).toBe(400);
      expect(res.body.code, label).toBe('VALIDATION_FAILED');
    }
    expect(await counts(me)).toEqual(NOTHING);
  });

  it('a section over its cap rolls everything back: 409 LIMIT_REACHED', async () => {
    const http = await start({ PROFILE_MAX_SECTION_ITEMS: '2' });
    const me = await member('me');
    await http
      .post('/v1/me/experience')
      .set(me.auth)
      .send(exp({ title: 'Existing' }))
      .expect(201);
    const res = await confirm(
      http,
      me,
      body({
        education: [edu()],
        experience: [exp({ title: 'A' }), exp({ title: 'B' })],
        skills: ['Rust'],
      }),
    ).expect(409);
    expect(res.body.code).toBe('LIMIT_REACHED');
    // the education insert, the skill and the sync time all rolled back
    expect(await counts(me)).toEqual({ ...NOTHING, experience: 1 });
  });

  it('the skill cap, after deduplication, also rolls everything back', async () => {
    const http = await start({ PROFILE_MAX_SKILLS: '3' });
    const me = await member('me');
    await http
      .put('/v1/me/skills')
      .set(me.auth)
      .send({ skills: ['A1', 'B1'] })
      .expect(200);
    const res = await confirm(
      http,
      me,
      body({ experience: [exp()], skills: ['a1', 'C1', 'D1'] }),
    ).expect(409);
    expect(res.body.code).toBe('LIMIT_REACHED');
    expect(await counts(me)).toEqual({ ...NOTHING, skills: 2 });
    // exactly at the cap is fine
    await confirm(http, me, body({ skills: ['a1', 'C1'] })).expect(200);
    expect((await counts(me)).skills).toBe(3);
  });

  it('two concurrent identical confirms give one set of rows', async () => {
    const http = await start();
    const me = await member('me');
    await http.get('/v1/me').set(me.auth).expect(200);
    const payload = body({
      experience: [exp()],
      education: [edu()],
      certifications: [cert()],
      skills: ['TypeScript'],
    });
    // hold the user's row, queue both confirms behind it, then release
    const holder = await createConnection({ uri: testDatabaseUrl() });
    await holder.beginTransaction();
    await holder.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [me.user.id]);
    const a = confirm(http, me, payload).then((r) => r);
    const b = confirm(http, me, payload).then((r) => r);
    await waitForLockWaiters(2);
    await holder.commit();
    await holder.end();

    const [ra, rb] = [await a, await b];
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const added = [ra, rb].map(
      (r) => (r.body as { added: { experience: number } }).added.experience,
    );
    expect(added.sort()).toEqual([0, 1]);
    expect(await counts(me)).toMatchObject({
      experience: 1,
      education: 1,
      certifications: 1,
      skills: 1,
    });
  });

  it('writes only the caller’s rows; another user is untouched', async () => {
    const http = await start();
    const me = await member('me');
    const other = await member('other');
    await http.post('/v1/me/experience').set(other.auth).send(exp()).expect(201);
    await confirm(http, me, body({ experience: [exp()], skills: ['Go'] })).expect(200);
    expect(await counts(other)).toEqual({ ...NOTHING, experience: 1 });
    expect((await counts(me)).experience).toBe(1);
  });

  it('needs a token, and has its own counter under the linkedin budget', async () => {
    const http = await start({ RATE_LIMIT_LINKEDIN: '2', RATE_LIMIT_DEFAULT: '50' });
    const me = await member('me');
    await http.post('/v1/me/imports/linkedin/confirm').send(body()).expect(401);
    await confirm(http, me, body()).expect(200);
    await confirm(http, me, body()).expect(200);
    const limited = await confirm(http, me, body());
    expect(limited.status).toBe(429);
    await http.get('/v1/me').set(me.auth).expect(200);
  });

  it('works end to end from a preview: edit the proposal, confirm, preview again shows duplicates', async () => {
    const http = await start();
    const me = await member('me');
    const fx = (n: string) =>
      readFileSync(new URL(`../../../testing/fixtures/linkedin/${n}`, import.meta.url));
    const zip = buildZip([
      { name: 'Positions.csv', data: fx('Positions.csv') },
      { name: 'Education.csv', data: fx('Education.csv') },
      { name: 'Skills.csv', data: fx('Skills.csv') },
      { name: 'Certifications.csv', data: fx('Certifications.csv') },
    ]);
    interface Item {
      status: string;
      fields: Record<string, unknown>;
    }
    interface Preview {
      experience: Item[];
      education: Item[];
      certifications: Item[];
      skills: { name: string; status: string }[];
    }
    const previewOnce = async (): Promise<Preview> => {
      const t = await http
        .post('/v1/me/imports/linkedin/uploads')
        .set(me.auth)
        .send({ size: zip.length })
        .expect(201);
      storage.putSigned(t.body as never, zip);
      const res = await http
        .post('/v1/me/imports/linkedin/preview')
        .set(me.auth)
        .send({ uploadId: (t.body as { uploadId: string }).uploadId })
        .expect(200);
      return res.body as Preview;
    };

    const p = await previewOnce();
    const picked = (items: Item[]) => items.filter((i) => i.status === 'new').map((i) => i.fields);
    // the student fills the missing field of study, then picks the first education entry
    const education = p.education.slice(0, 1).map((i) => ({
      ...i.fields,
      field: 'Computer Science',
      degree: (i.fields.degree as string) || 'BSc',
    }));
    const res = await confirm(
      http,
      me,
      body({
        experience: picked(p.experience),
        education,
        certifications: picked(p.certifications),
        skills: p.skills.filter((s) => s.status === 'new').map((s) => s.name),
      }),
    ).expect(200);
    expect(res.body.added).toEqual({ experience: 2, education: 1, certifications: 2, skills: 3 });

    const again = await previewOnce();
    expect(again.experience.filter((i) => i.status === 'duplicate')).toHaveLength(2);
    expect(again.skills.every((s) => s.status === 'duplicate')).toBe(true);
  });
});
