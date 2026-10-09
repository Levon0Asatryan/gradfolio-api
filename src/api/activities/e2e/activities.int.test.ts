import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { toJsonColumn } from '../../../core/db/json.js';
import { translationParams } from '../../../core/validation/json-shapes.js';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig, testDatabase } from '../../../testing/database.js';
import { createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/** M5 PR (c): GET /v1/me/activities -- the caller's own feed, newest first, paged. */

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

const at = (s: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, s));
async function add(userId: string, key: string, params: Record<string, string | number>, t: Date) {
  const id = newId();
  await db
    .insertInto('activities')
    .values({
      id,
      userId,
      type: 'project',
      translationKey: key,
      translationParams: toJsonColumn(translationParams, params),
      timestamp: t,
    })
    .execute();
  return id;
}

interface Page {
  items: {
    id: string;
    type: string;
    translationKey: string;
    translationParams: unknown;
    timestamp: string;
  }[];
  nextCursor: string | null;
}

describe('GET /v1/me/activities', () => {
  it('lists only the caller’s feed, newest first, as key + params', async () => {
    const http = await start();
    const alice = await member('alice');
    const bob = await member('bob');
    const a1 = await add(
      alice.user.id,
      'projectCreated',
      { projectId: 'p', projectName: 'One' },
      at(1),
    );
    const a2 = await add(
      alice.user.id,
      'projectPublished',
      { projectId: 'p', projectName: 'One' },
      at(2),
    );
    await add(
      bob.user.id,
      'projectCreated',
      { projectId: 'q', projectName: 'Bob’s secret' },
      at(3),
    );

    const res = await http.get('/v1/me/activities').set(alice.auth).expect(200);
    const page = res.body as Page;
    expect(page.items.map((i) => i.id)).toEqual([a2, a1]);
    expect(page.items[0]).toEqual({
      id: a2,
      type: 'project',
      translationKey: 'projectPublished',
      translationParams: { projectId: 'p', projectName: 'One' },
      timestamp: at(2).toISOString(),
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    // the other user's feed holds only theirs
    const theirs = await http.get('/v1/me/activities').set(bob.auth).expect(200);
    expect((theirs.body as Page).items.map((i) => i.translationParams)).toEqual([
      { projectId: 'q', projectName: 'Bob’s secret' },
    ]);
  });

  it('is empty for a user with no activity', async () => {
    const http = await start();
    const alice = await member('alice');
    const res = await http.get('/v1/me/activities').set(alice.auth).expect(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it('pages without repeating or skipping, ties on the second broken by id', async () => {
    const http = await start({ ACTIVITIES_PAGE_SIZE: '2' });
    const alice = await member('alice');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await add(alice.user.id, 'newSkill', { skillName: `s${i}` }, at(i < 3 ? 1 : i)));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 5; guard++) {
      const res = await http
        .get('/v1/me/activities')
        .query(cursor === null ? {} : { cursor })
        .set(alice.auth)
        .expect(200);
      const page = res.body as Page;
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(new Set(seen).size).toBe(5);
    expect(seen.toSorted()).toEqual(ids.toSorted());
    // newest first across pages
    const times = await Promise.all(
      seen.map(async (id) =>
        (
          await db
            .selectFrom('activities')
            .select('timestamp')
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).timestamp.getTime(),
      ),
    );
    expect(times).toEqual(times.toSorted((a, b) => b - a));
  });

  it.each([
    ['a cursor that is not one', { cursor: 'nope' }],
    ['a limit over the maximum', { limit: '51' }],
    ['a limit of zero', { limit: '0' }],
    ['an unknown key', { sort: 'oldest' }],
  ])('answers 400 for %s', async (_n, query) => {
    const http = await start();
    const alice = await member('alice');
    const res = await http.get('/v1/me/activities').query(query).set(alice.auth).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('answers 400, not a database error, for a cursor time beyond the Date range', async () => {
    const http = await start();
    const alice = await member('alice');
    const cursor = Buffer.from(JSON.stringify({ t: 8_640_000_000_000_001, id: 'x' })).toString(
      'base64url',
    );
    const res = await http.get('/v1/me/activities').query({ cursor }).set(alice.auth).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('needs a token, and answers 429 once the budget is spent', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '2' });
    await http.get('/v1/me/activities').expect(401);
    const alice = await member('alice');
    await http.get('/v1/me/activities').set(alice.auth).expect(200);
    await http.get('/v1/me/activities').set(alice.auth).expect(200);
    await http.get('/v1/me/activities').set(alice.auth).expect(429);
  });
});
