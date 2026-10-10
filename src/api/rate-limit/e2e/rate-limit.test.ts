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
      // The same number for a visitor with no vouched-for address, so the
      // address tests below keep their meaning (plan §2.4).
      RATE_LIMIT_DEFAULT_SHARED: '3',
      ...env,
    }),
    stubDb(),
    { controllers: [ProbeController], logs },
  );
  return request(app.getHttpServer());
}

async function stop() {
  await app?.close();
  app = undefined;
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

describe('the forwarded client address (D4, docs/m6-plan.md §2.4)', () => {
  const SECRET = 'a'.repeat(40);
  const PREVIOUS = 'b'.repeat(40);
  const vouched = (ip: string, secret = SECRET) => ({
    'X-Gradfolio-Proxy-Secret': secret,
    'X-Client-IP': ip,
  });
  const get = (http: Awaited<ReturnType<typeof start>>, headers: Record<string, string>) =>
    http.get('/v1/probe/public').set(headers);

  it('gives each vouched-for visitor their own budget, though the connection is shared', async () => {
    const http = await start({ PROXY_SHARED_SECRETS: SECRET });
    for (let i = 0; i < 3; i++) await get(http, vouched('203.0.113.1')).expect(200);
    await get(http, vouched('203.0.113.1')).expect(429);
    // Another visitor, same connection, same secret: untouched.
    await get(http, vouched('203.0.113.2')).expect(200);
  });

  it('ignores the address without the secret, a wrong secret, or no secret configured', async () => {
    const http = await start({ PROXY_SHARED_SECRETS: SECRET });
    // Three different claimed addresses, none vouched for: one shared counter.
    await get(http, { 'X-Client-IP': '198.51.100.1' }).expect(200);
    await get(http, vouched('198.51.100.2', 'x'.repeat(40))).expect(200);
    await get(http, vouched('198.51.100.3', 'x'.repeat(40))).expect(200);
    await get(http, { 'X-Client-IP': '198.51.100.4' }).expect(429);
    await stop();

    const open = await start({}); // no secret configured: the headers mean nothing
    for (let i = 1; i <= 3; i++) await get(open, vouched(`198.51.100.${i}`)).expect(200);
    await get(open, vouched('198.51.100.9')).expect(429);
  });

  it('counts a garbage forwarded address against the shared connection, never as unlimited', async () => {
    const http = await start({ PROXY_SHARED_SECRETS: SECRET });
    for (let i = 0; i < 3; i++) await get(http, vouched('not-an-ip')).expect(200);
    await get(http, vouched('still not an ip')).expect(429);
  });

  it('accepts the previous secret while one is being rotated out', async () => {
    const http = await start({ PROXY_SHARED_SECRETS: `${SECRET},${PREVIOUS}` });
    for (let i = 0; i < 3; i++) await get(http, vouched('203.0.113.7', PREVIOUS)).expect(200);
    await get(http, vouched('203.0.113.7', SECRET)).expect(429); // the same visitor, either secret
    await get(http, vouched('203.0.113.8', PREVIOUS)).expect(200);
  });

  it('gives the shared connection the higher number and a vouched-for visitor the normal one', async () => {
    const http = await start({
      PROXY_SHARED_SECRETS: SECRET,
      RATE_LIMIT_DEFAULT: '2',
      RATE_LIMIT_DEFAULT_SHARED: '4',
    });
    for (let i = 0; i < 4; i++) await get(http, {}).expect(200);
    await get(http, {}).expect(429);
    await get(http, vouched('203.0.113.1')).expect(200);
    await get(http, vouched('203.0.113.1')).expect(200);
    await get(http, vouched('203.0.113.1')).expect(429);
  });

  it('applies to the named budgets too', async () => {
    const http = await start({
      PROXY_SHARED_SECRETS: SECRET,
      RATE_LIMIT_DEFAULT: '50',
      RATE_LIMIT_DEFAULT_SHARED: '50',
      RATE_LIMIT_SEARCH: '1',
      RATE_LIMIT_SEARCH_SHARED: '3',
    });
    const search = (h: Record<string, string>) => http.get('/v1/probe/search').set(h);
    for (let i = 0; i < 3; i++) await search({}).expect(200);
    await search({}).expect(429);
    await search(vouched('203.0.113.1')).expect(200);
    await search(vouched('203.0.113.1')).expect(429);
  });

  it('lets a token win over a forwarded address, and never logs the secret', async () => {
    const http = await start({ PROXY_SHARED_SECRETS: SECRET });
    const alice = await as('auth0|alice');
    for (let i = 0; i < 3; i++) {
      await http
        .get('/v1/probe/optional')
        .set({ ...alice, ...vouched('203.0.113.1') })
        .expect(200);
    }
    await http
      .get('/v1/probe/optional')
      .set({ ...alice, ...vouched('203.0.113.2') })
      .expect(429);
    expect(logs.text()).not.toContain(SECRET);
  });
});
