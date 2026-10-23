import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, it } from 'vitest';
import { buildApp, stubDb } from '../../testing/app.js';
import { testConfig } from '../../testing/database.js';

let app: NestExpressApplication;
beforeAll(async () => {
  app = await buildApp(testConfig({ LOG_LEVEL: 'fatal' }), stubDb());
});
afterAll(async () => {
  await app.close();
});

it('fails closed without a configured webhook secret', async () => {
  await request(app.getHttpServer())
    .post('/v1/email/webhooks/resend')
    .send({ type: 'email.bounced', data: {} })
    .expect(503, { code: 'EMAIL_UNAVAILABLE', message: 'email settings unavailable' });
});
