import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { retryAfterSeconds, upstreamRequest, UpstreamFailure } from './request.js';

/** The outbound request helper against a real local server: every failure class. */
describe('upstreamRequest', () => {
  let server: Server;
  let base: string;
  const hanging = new Set<ServerResponse>();
  const seen: { method?: string; contentType?: string; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method,
          contentType: req.headers['content-type'],
          body: Buffer.concat(chunks).toString(),
        });
        switch (req.url) {
          case '/json':
            res.writeHead(200, { 'content-type': 'application/json' }).end('{"a":1}');
            return;
          case '/text':
            res.writeHead(200, { 'content-type': 'text/plain' }).end('hello');
            return;
          case '/empty':
            res.writeHead(204).end();
            return;
          case '/bad-json':
            res.writeHead(200, { 'content-type': 'application/json' }).end('{"a":');
            return;
          case '/declared-large':
            res.writeHead(200, { 'content-type': 'application/json', 'content-length': '5000' });
            res.end('x'.repeat(5000));
            return;
          case '/streamed-large':
            res.writeHead(200, { 'content-type': 'application/json' });
            res.write('x'.repeat(600));
            res.end('x'.repeat(600));
            return;
          case '/redirect':
            res.writeHead(302, { location: '/json' }).end();
            return;
          case '/hang':
            hanging.add(res);
            return;
          default:
            res.writeHead(404).end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    for (const res of hanging) res.destroy();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const get = (path: string, over: Partial<Parameters<typeof upstreamRequest>[1]> = {}) =>
    upstreamRequest(new URL(path, base), {
      method: 'GET',
      headers: {},
      signal: AbortSignal.timeout(2000),
      maxBytes: 1000,
      ...over,
    });
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => undefined,
      (e: unknown) => (e instanceof UpstreamFailure ? e.kind : e),
    );

  it('parses a JSON body, leaves another type unparsed, and sends JSON with its type', async () => {
    expect((await get('/json')).body).toEqual({ a: 1 });
    expect((await get('/text')).body).toBeUndefined();
    const empty = await get('/empty');
    expect(empty.status).toBe(204);
    expect(empty.body).toBeUndefined();
    await get('/json', { method: 'POST', json: { x: 'y' } });
    expect(seen.at(-1)).toEqual({
      method: 'POST',
      contentType: 'application/json',
      body: '{"x":"y"}',
    });
  });

  it('classifies each failure, and never follows a redirect', async () => {
    expect(await failure(get('/bad-json'))).toBe('bad_body');
    expect(await failure(get('/declared-large'))).toBe('too_large');
    expect(await failure(get('/streamed-large'))).toBe('too_large');
    expect(await failure(get('/redirect'))).toBe('network');
    expect(await failure(get('/hang', { signal: AbortSignal.timeout(100) }))).toBe('timeout');
    const ctl = new AbortController();
    const pending = failure(get('/hang', { signal: ctl.signal }));
    ctl.abort();
    expect(await pending).toBe('aborted');
    expect(await failure(get('http://127.0.0.1:9/'))).toBe('network');
  });

  it('names a failure by class and code only', async () => {
    const err = (await get('/redirect').catch((e: unknown) => e)) as UpstreamFailure;
    expect(err).toBeInstanceOf(UpstreamFailure);
    expect(err.source).toBe('TypeError Error');
    const refused = (await get('http://127.0.0.1:1/').catch((e: unknown) => e)) as UpstreamFailure;
    expect(refused.source).not.toContain('127.0.0.1');
    expect(err.message).not.toContain('127.0.0.1');
  });
});

describe('retryAfterSeconds', () => {
  const now = 1_700_000_000_000;
  it('prefers Retry-After, else the reset time, at least 1 second', () => {
    expect(retryAfterSeconds(new Headers({ 'retry-after': '37' }), 'x-ratelimit-reset', now)).toBe(
      37,
    );
    expect(retryAfterSeconds(new Headers({ 'retry-after': '0' }), 'x-ratelimit-reset', now)).toBe(
      1,
    );
    expect(
      retryAfterSeconds(
        new Headers({ 'x-ratelimit-reset': String(now / 1000 + 90) }),
        'x-ratelimit-reset',
        now,
      ),
    ).toBe(90);
    expect(
      retryAfterSeconds(
        new Headers({ 'x-ratelimit-reset': String(now / 1000 - 5) }),
        'x-ratelimit-reset',
        now,
      ),
    ).toBe(1);
    expect(
      retryAfterSeconds(new Headers({ 'retry-after': 'soon' }), 'x-ratelimit-reset', now),
    ).toBeUndefined();
    expect(retryAfterSeconds(new Headers(), 'x-ratelimit-reset', now)).toBeUndefined();
  });
});
