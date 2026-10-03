import { createHmac } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, captureLogs, type LogCapture, stubDb } from '../../../testing/app.js';
import { testConfig } from '../../../testing/database.js';
import { b64url, startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { ProbeController } from '../../../testing/probe.controller.js';

/**
 * The access-token guard through the whole HTTP pipeline: every route needs a
 * token unless it is @Public(), every refusal answers the same body, and
 * nothing from the token or the library reaches the response or the log.
 */

const UNAUTHENTICATED = { code: 'UNAUTHENTICATED', message: 'authentication required' };
const SECRET_EMAIL = 'never-logged@example.test';

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs: LogCapture = captureLogs();

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
afterEach(async () => {
  logs.clear();
  tenant.mode = 'ok';
  await app?.close();
  app = undefined;
});

async function start(env: NodeJS.ProcessEnv = {}) {
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'info',
      API_DOCS_ENABLED: 'true',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
      AUTH0_JWKS_TIMEOUT_MS: '300',
      ...env,
    }),
    stubDb(),
    { controllers: [ProbeController], logs },
  );
  return request(app.getHttpServer());
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('the access-token guard', () => {
  it('lets a valid token through and hands the handler the verified subject', async () => {
    const http = await start();
    const res = await http
      .get('/v1/probe')
      .set(bearer(await tenant.sign({ sub: 'github|42' })))
      .expect(200);
    expect(res.body).toEqual({ sub: 'github|42' });
  });

  it('refuses a request with no token: 401, the fixed body and a bearer challenge', async () => {
    const http = await start();
    const res = await http.get('/v1/probe').expect(401);
    expect(res.body).toEqual(UNAUTHENTICATED);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it.each(['Basic dXNlcjpwYXNz', 'Bearer', 'Token abc'])(
    'refuses the non-bearer Authorization %j',
    async (header) => {
      const http = await start();
      const res = await http.get('/v1/probe').set('Authorization', header).expect(401);
      expect(res.body).toEqual(UNAUTHENTICATED);
    },
  );

  describe('refuses every invalid token with the same body, and logs only a reason', () => {
    const cases: [string, string, () => Promise<string>][] = [
      ['malformed', 'malformed', () => Promise.resolve('not.a.jwt')],
      [
        'alg none',
        'alg',
        () =>
          Promise.resolve(
            `${b64url({ alg: 'none' })}.${b64url({ sub: 'auth0|x', email: SECRET_EMAIL })}.`,
          ),
      ],
      [
        'HS256 with the public key',
        'alg',
        async () => {
          const h = b64url({ alg: 'HS256', kid: 'k1' });
          const p = b64url({ sub: 'auth0|x', iss: tenant.issuer, aud: tenant.audience });
          const sig = createHmac('sha256', await tenant.publicKeyPem())
            .update(`${h}.${p}`)
            .digest('base64url');
          return `${h}.${p}.${sig}`;
        },
      ],
      ['wrong issuer', 'claim:iss', () => tenant.sign({ iss: 'https://evil.example/' })],
      ['wrong audience', 'claim:aud', () => tenant.sign({ aud: 'https://other.api' })],
      ['expired', 'expired', () => tenant.sign({ expIn: -600 })],
      ['not yet valid', 'claim:nbf', () => tenant.sign({ nbfIn: 600 })],
      ['no expiry', 'claim:exp', () => tenant.sign({ expIn: null })],
      ['unknown key id', 'unknown-key', () => tenant.sign({}, { kid: 'zz', key: 'other' })],
      ['a different key', 'signature', () => tenant.sign({}, { kid: 'k1', key: 'other' })],
    ];

    it.each(cases)('%s', async (_label, reason, make) => {
      const http = await start();
      const token = await make();
      const res = await http.get('/v1/probe').set(bearer(token)).expect(401);

      expect(res.body).toEqual(UNAUTHENTICATED);
      expect(res.headers['www-authenticate']).toBe('Bearer');

      const rejected = logs.lines().find((l) => l.msg === 'request rejected');
      expect(rejected).toMatchObject({
        status: 401,
        code: 'UNAUTHENTICATED',
        cause: `access token rejected: ${reason}`,
      });
      const text = logs.text();
      expect(text).not.toContain(token);
      expect(text).not.toContain(SECRET_EMAIL);
      // jose's own wording never reaches the log.
      expect(text).not.toMatch(/claim validation failed|signature verification failed|"alg"/i);
    });
  });

  it('keeps profile claims of a refused token out of the log', async () => {
    const http = await start();
    const token = await tenant.sign({
      iss: 'https://evil.example/',
      profile: { email: SECRET_EMAIL },
    });
    await http.get('/v1/probe').set(bearer(token)).expect(401);
    expect(logs.text()).not.toContain(SECRET_EMAIL);
    expect(logs.text()).not.toContain(token);
  });

  it('answers 503 AUTH_UNAVAILABLE, not 401, when the key set cannot be fetched', async () => {
    tenant.mode = 'hang';
    const http = await start();
    const res = await http
      .get('/v1/probe')
      .set(bearer(await tenant.sign()))
      .expect(503);
    expect(res.body).toEqual({
      code: 'AUTH_UNAVAILABLE',
      message: 'authentication is temporarily unavailable',
    });
    const failed = logs.lines().find((l) => l.msg === 'request failed');
    expect(failed).toMatchObject({
      status: 503,
      cause: 'token signing keys unavailable: JWKSTimeout ERR_JWKS_TIMEOUT',
    });
  });

  it('answers 503 when the tenant refuses the connection', async () => {
    const http = await start({ AUTH0_ISSUER_BASE_URL: 'http://127.0.0.1:1/' });
    const token = await tenant.sign({ iss: 'http://127.0.0.1:1/' });
    const res = await http.get('/v1/probe').set(bearer(token)).expect(503);
    expect(res.body.code).toBe('AUTH_UNAVAILABLE');
  });
});

describe('the route policy', () => {
  it('protects a route that does not say otherwise', async () => {
    const http = await start();
    await http.get('/v1/probe').expect(401);
  });

  it('serves a @Public() route without a token, and verifies nothing there', async () => {
    const http = await start();
    const res = await http.get('/v1/probe/public').set(bearer('garbage')).expect(200);
    expect(res.body).toEqual({});
  });

  it('keeps health and the API document public', async () => {
    const http = await start();
    await http.get('/healthz').expect(200);
    await http.get('/readyz').expect(200);
    await http.get('/docs-json').expect(200);
    const docs = await http.get('/docs').redirects(1);
    expect(docs.status).toBe(200);
  });

  it('answers an unknown path 404 with or without a token: the router answers first', async () => {
    const http = await start();
    await http.get('/v1/nope').expect(404);
    await http
      .get('/v1/nope')
      .set(bearer(await tenant.sign()))
      .expect(404);
  });
});
