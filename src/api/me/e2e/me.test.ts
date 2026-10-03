import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, stubDb } from '../../../testing/app.js';
import { testConfig } from '../../../testing/database.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';

/**
 * GET /v1/me without a database: the route, the guards and the response
 * mapping. The row comes from testing/app.ts `stubUsers`; provisioning in
 * real MySQL is me.int.test.ts.
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start() {
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'fatal',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
    }),
    stubDb(),
  );
  return request(app.getHttpServer());
}

describe('GET /v1/me (no database)', () => {
  it('returns the caller resolved by the user guard, mapped to the response shape', async () => {
    const http = await start();
    const token = await tenant.sign({
      sub: 'github|7',
      profile: {
        name: 'Gor',
        email: 'gor@example.com',
        email_verified: true,
        identities: ['github'],
      },
    });
    const res = await http.get('/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body).toEqual({
      id: 'stub-github|7',
      name: 'Gor',
      email: 'gor@example.com',
      avatarUrl: null,
      headline: '',
      verified: true,
      isPublic: true,
      identities: ['github'],
    });
  });

  it('names the login provider from the subject when the token lists no identities', async () => {
    const http = await start();
    const token = await tenant.sign({ sub: 'linkedin|abc' });
    const res = await http.get('/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.identities).toEqual(['linkedin']);
  });

  it('is protected: 401 without a token', async () => {
    const http = await start();
    await http.get('/v1/me').expect(401, {
      code: 'UNAUTHENTICATED',
      message: 'authentication required',
    });
  });

  it('leaves public routes alone: health resolves no caller', async () => {
    const http = await start();
    await http.get('/healthz').expect(200);
  });
});
