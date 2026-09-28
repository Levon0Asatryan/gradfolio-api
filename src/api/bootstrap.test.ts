import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, stubDb } from '../testing/app.js';
import { testConfig } from '../testing/database.js';

/**
 * The whole HTTP pipeline -- prefix, filter, body limit, fallback, docs switch --
 * over a real Express server, with only the database stubbed.
 */
describe('the configured application', () => {
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(env: NodeJS.ProcessEnv = {}, ping?: () => Promise<void>) {
    app = await buildApp(testConfig({ LOG_LEVEL: 'fatal', ...env }), stubDb(ping));
    return request(app.getHttpServer());
  }

  it('serves health outside the version prefix, and only there', async () => {
    const http = await start();

    await http.get('/healthz').expect(200, { status: 'ok' });
    await http.get('/readyz').expect(200, { status: 'ok', database: 'ok' });
    await http.get('/v1/healthz').expect(404, { code: 'NOT_FOUND', message: 'resource not found' });
  });

  it('answers an unmatched path with JSON, inside and outside the prefix alike', async () => {
    const http = await start();
    const inside = await http.get('/v1/nope').expect(404);
    const outside = await http.get('/nope').expect(404);

    expect(inside.headers['content-type']).toMatch(/application\/json/);
    expect(outside.body).toEqual(inside.body);
    expect(inside.body).toEqual({ code: 'NOT_FOUND', message: 'resource not found' });
  });

  it('does not announce the framework', async () => {
    const http = await start();
    const res = await http.get('/healthz');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects a body over the configured limit with 413 and a stable code', async () => {
    const http = await start({ API_BODY_LIMIT: '1kb' });
    await http
      .post('/v1/anything')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(2048) }))
      .expect(413, { code: 'PAYLOAD_TOO_LARGE', message: 'request body is too large' });
  });

  it('rejects malformed JSON with 400, without echoing the parser', async () => {
    const http = await start();
    const res = await http
      .post('/v1/anything')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(res.body).toEqual({ code: 'BAD_REQUEST', message: 'request could not be understood' });
  });

  it('reports the database outage on readiness only', async () => {
    const http = await start({}, () =>
      Promise.reject(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })),
    );
    await http.get('/healthz').expect(200);
    await http
      .get('/readyz')
      .expect(503, { code: 'DATABASE_UNAVAILABLE', message: 'database is not reachable' });
  });

  it('serves no documentation unless enabled', async () => {
    const http = await start();
    await http.get('/docs').expect(404);
    await http.get('/docs-json').expect(404);
  });

  it('serves the generated document when enabled', async () => {
    const http = await start({ API_DOCS_ENABLED: 'true' });
    const res = await http.get('/docs-json').expect(200);
    expect((res.body as { info: { title: string } }).info.title).toBe('Gradfolio API');
    await http.get('/docs').expect(200);
  });
});
