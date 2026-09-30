import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp, captureLogs, stubDb } from '../../../testing/app.js';
import { testConfig } from '../../../testing/database.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { ProbeController } from '../../../testing/probe.controller.js';

/**
 * The rate-limit guard through the whole HTTP pipeline, with small budgets.
 * Each test builds its own application, so budgets start empty.
 */

const RATE_LIMITED = { code: 'RATE_LIMITED', message: 'too many requests' };

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
afterEach(async () => {
  vi.useRealTimers();
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
      RATE_LIMIT_DEFAULT: '3',
      ...env,
    }),
    stubDb(),
    { controllers: [ProbeController], logs },
  );
  return request(app.getHttpServer());
}

const as = async (sub: string) => ({ Authorization: `Bearer ${await tenant.sign({ sub })}` });

describe('the default budget', () => {
  it('answers 429 RATE_LIMITED with a standard Retry-After once it is spent', async () => {
    const http = await start();
    const alice = await as('auth0|alice');
    for (let i = 0; i < 3; i++) {
      const ok = await http.get('/v1/probe').set(alice).expect(200);
      expect(Object.keys(ok.headers).filter((h) => /ratelimit/i.test(h))).toEqual([]);
    }

    const res = await http.get('/v1/probe').set(alice).expect(429);
    expect(res.body).toEqual(RATE_LIMITED);
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    // No per-budget headers: they would name each budget.
    expect(Object.keys(res.headers).filter((h) => /ratelimit|retry-after-/i.test(h))).toEqual([]);
  });

  // Also proves the guard order: were the limit checked before the token,
  // `req.auth` would be unset and both users would share the address key.
  it('is per user, so users behind one address (the frontend server) do not share it', async () => {
    const http = await start();
    const alice = await as('auth0|alice');
    for (let i = 0; i < 3; i++) await http.get('/v1/probe').set(alice).expect(200);
    await http.get('/v1/probe').set(alice).expect(429);

    await http
      .get('/v1/probe')
      .set(await as('auth0|bob'))
      .expect(200);
  });

  it('keys anonymous requests by address, which a spoofed X-Forwarded-For does not change', async () => {
    const http = await start({ TRUST_PROXY: 'false' });
    for (let i = 1; i <= 3; i++) {
      await http.get('/v1/probe/public').set('X-Forwarded-For', `10.0.0.${i}`).expect(200);
    }
    await http.get('/v1/probe/public').set('X-Forwarded-For', '10.0.0.4').expect(429);
  });

  it('behind one trusted proxy, keys by the address that proxy appended', async () => {
    const http = await start({ TRUST_PROXY: '1' });
    // The client writes the first entry; our proxy appends the real address.
    for (let i = 1; i <= 3; i++) {
      await http
        .get('/v1/probe/public')
        .set('X-Forwarded-For', `6.6.6.${i}, 203.0.113.9`)
        .expect(200);
    }
    await http.get('/v1/probe/public').set('X-Forwarded-For', '6.6.6.4, 203.0.113.9').expect(429);
    await http.get('/v1/probe/public').set('X-Forwarded-For', '6.6.6.4, 203.0.113.10').expect(200);
  });

  it('counts a window in seconds, not milliseconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const http = await start({ RATE_LIMIT_DEFAULT: '1', RATE_LIMIT_WINDOW_S: '60' });
    const alice = await as('auth0|alice');
    await http.get('/v1/probe').set(alice).expect(200);

    vi.setSystemTime(Date.now() + 1_000);
    await http.get('/v1/probe').set(alice).expect(429);

    vi.setSystemTime(Date.now() + 60_000);
    await http.get('/v1/probe').set(alice).expect(200);
  });
});

describe('named budgets', () => {
  it('apply only to routes that opted in', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '10', RATE_LIMIT_SEARCH: '2' });
    const alice = await as('auth0|alice');
    await http.get('/v1/probe/search').set(alice).expect(200);
    await http.get('/v1/probe/search').set(alice).expect(200);
    await http.get('/v1/probe/search').set(alice).expect(429);

    // The same user's other routes are untouched by the search budget.
    for (let i = 0; i < 5; i++) await http.get('/v1/probe').set(alice).expect(200);
    await http.get('/v1/probe/import').set(alice).expect(200);
  });

  it('each block on their own (nestjs/throttler#2709)', async () => {
    const http = await start({
      RATE_LIMIT_DEFAULT: '10',
      RATE_LIMIT_SEARCH: '1',
      RATE_LIMIT_IMPORT: '1',
    });
    const alice = await as('auth0|alice');
    await http.get('/v1/probe/search').set(alice).expect(200);
    await http.get('/v1/probe/import').set(alice).expect(200);
    await http.get('/v1/probe/search').set(alice).expect(429);
    await http.get('/v1/probe/import').set(alice).expect(429);
  });

  it('still count against the default budget', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '2', RATE_LIMIT_SEARCH: '10' });
    const alice = await as('auth0|alice');
    await http.get('/v1/probe/search').set(alice).expect(200);
    await http.get('/v1/probe/search').set(alice).expect(200);
    const res = await http.get('/v1/probe/search').set(alice).expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('logging', () => {
  it('logs a refusal as a warning with its code, never the token', async () => {
    const http = await start({ RATE_LIMIT_DEFAULT: '1' });
    const auth = await as('auth0|alice');
    await http.get('/v1/probe').set(auth).expect(200);
    await http.get('/v1/probe').set(auth).expect(429);
    expect(logs.lines().find((l) => l.msg === 'request rejected')).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
    expect(logs.text()).not.toContain(auth.Authorization.slice(7));
  });
});
