import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { createConnection } from 'mysql2/promise';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testConfig, testDatabaseUrl } from '../../../testing/database.js';
import { createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { db } from '../../../testing/team.js';

/**
 * `verified` is "email verified or GitHub connected" (D5, docs/modules/m7/plan.md §5.1),
 * recomputed on every request: without the GitHub half, a connected student
 * with an unverified email flips back to false on the next request.
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();

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

async function start() {
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'warn',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
    }),
    undefined,
    { logs },
  );
  return request(app.getHttpServer());
}

async function withGithub(
  status: 'connected' | 'linking' | 'not_connected',
  emailVerified: boolean,
) {
  const sub = `auth0|${newId()}`;
  const user = await createUser(db, { auth0Id: sub, verified: true });
  await db
    .insertInto('integrations')
    .values({
      id: newId(),
      userId: user.id,
      integrationType: 'github',
      status,
      externalUserId: status === 'not_connected' ? null : String(Date.now() + Math.random()),
    })
    .execute();
  const token = await tenant.sign({ sub, profile: { email_verified: emailVerified } });
  return { id: user.id, auth: { Authorization: `Bearer ${token}` } };
}

const stored = async (id: string) =>
  (await db.selectFrom('users').select('verified').where('id', '=', id).executeTakeFirstOrThrow())
    .verified;

describe('verified counts a connected GitHub', () => {
  it('a GitHub-connected student with an unverified email stays verified across requests', async () => {
    const http = await start();
    const s = await withGithub('connected', false);
    for (let i = 0; i < 2; i++) {
      expect((await http.get('/v1/me').set(s.auth).expect(200)).body.verified).toBe(true);
    }
    expect(await stored(s.id)).toBe(true);
  });

  it('a reservation or a disconnected row does not count: back to the email', async () => {
    const http = await start();
    for (const status of ['linking', 'not_connected'] as const) {
      const s = await withGithub(status, false);
      expect((await http.get('/v1/me').set(s.auth).expect(200)).body.verified, status).toBe(false);
      expect(await stored(s.id)).toBe(false);
    }
  });

  it('a verified email is enough without GitHub', async () => {
    const http = await start();
    const s = await withGithub('not_connected', true);
    expect((await http.get('/v1/me').set(s.auth).expect(200)).body.verified).toBe(true);
  });

  it('another student’s connected GitHub does not make the caller verified (second user)', async () => {
    const http = await start();
    await withGithub('connected', false);
    const plain = await createUser(db, { auth0Id: 'auth0|plain', verified: true });
    const token = await tenant.sign({ sub: 'auth0|plain', profile: { email_verified: false } });
    await http
      .get('/v1/me')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(await stored(plain.id)).toBe(false);
  });

  it('a connect committed while the request decides cannot be overwritten with false (barrier)', async () => {
    const http = await start();
    // Stored verified from an older email-verified token; this token says false.
    const s = await withGithub('not_connected', false);
    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [s.id]);
      // The request read "not connected" and now waits to write false ...
      const request = http
        .get('/v1/me')
        .set(s.auth)
        .then((r) => r);
      await waitForLockWaiters(1);
      // ... while a connect, under the same lock, commits.
      await holder.query(
        "UPDATE integrations SET status = 'connected', generation = generation + 1 WHERE user_id = ?",
        [s.id],
      );
      await holder.query('UPDATE users SET verified = 1 WHERE id = ?', [s.id]);
      await holder.query('COMMIT');

      const res = await request;
      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
    } finally {
      await holder.end();
    }
    expect(await stored(s.id)).toBe(true);
  });
});
