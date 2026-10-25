import { createServer, type Server } from 'node:http';
import { randomUUID, createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../testing/database.js';
import { DisabledMailer, MailDeliveryError, type EmailMessage } from './mailer.js';
import { ResendMailer } from './resend.js';
import { productionMailer } from './production-mailer.js';
import { verifyResendWebhook } from './resend-webhook.js';

const message: EmailMessage = {
  to: 'recipient@example.com',
  subject: 'Թիմ / Команда',
  text: 'Join /teams',
  html: '<p>Join</p>',
  idempotencyKey: randomUUID(),
};
const messageId = randomUUID();
let server: Server;
let origin: string;
let status = 200;
let responseBody = JSON.stringify({ id: messageId });
let captured: { url?: string; headers?: Record<string, unknown>; body?: unknown };
const transport: typeof fetch = (_url, init) => fetch(origin, init);
const mailer = () =>
  new ResendMailer('re_testonly', 'invites@example.com', 'help@example.com', transport);

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured = {
        url: req.url,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString()) as unknown,
      };
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(responseBody);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no test server');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Resend HTTP adapter', () => {
  it('sends the stable key, correlation tag, both body parts and configured sender over HTTP', async () => {
    status = 200;
    responseBody = JSON.stringify({ id: messageId });
    const result = await mailer().send(message, new AbortController().signal);
    expect(result.messageId).toBe(messageId);
    expect(captured.headers).toMatchObject({
      authorization: 'Bearer re_testonly',
      'idempotency-key': message.idempotencyKey,
    });
    expect(captured.body).toEqual({
      from: 'Gradfolio <invites@example.com>',
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: 'help@example.com',
      tags: [{ name: 'outbox_id', value: message.idempotencyKey }],
    });
    const first = captured.body;
    await mailer().send(message, new AbortController().signal);
    expect(captured.body).toEqual(first);
    expect(mailer().idempotencyWindowMs).toBeLessThan(86400_000);
  });
  it.each([
    [429, 'rate_limit_exceeded', 'temporary'],
    [500, 'application_error', 'temporary'],
    [503, 'service_unavailable', 'temporary'],
    [409, 'concurrent_idempotent_requests', 'temporary'],
    [401, 'validation_error', 'permanent'],
    [422, 'validation_error', 'permanent'],
    [409, 'invalid_idempotent_request', 'permanent'],
    [429, 'daily_quota_exceeded', 'temporary'],
    [429, 'monthly_quota_exceeded', 'temporary'],
  ] as const)('classifies %s %s as %s', async (code, name, kind) => {
    status = code;
    responseBody = JSON.stringify({ name, message: 'private provider response' });
    await expect(mailer().send(message, new AbortController().signal)).rejects.toMatchObject({
      kind,
      message: 'mail delivery failed',
    });
  });
  it.each([
    [200, '{}'],
    [200, 'broken'],
    [502, '{"name":"proxy_failure"}'],
    [500, '<html>private</html>'],
    [200, 'x'.repeat(4097)],
  ] as const)('keeps ambiguous %s outcomes uncertain without provider data', async (code, body) => {
    status = code;
    responseBody = body;
    const error = await mailer()
      .send(message, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MailDeliveryError);
    expect((error as Error).message).toBe('unknown mail delivery outcome');
  });
  it('honors abort and drops transport error details', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(mailer().send(message, controller.signal)).rejects.toThrow(
      'unknown mail delivery outcome',
    );
  });
  it('uses only the fixed provider origin and refuses redirects', async () => {
    let options: RequestInit | undefined;
    const transport: typeof fetch = (url, init) => {
      expect(url).toBe('https://api.resend.com/emails');
      options = init;
      return Promise.resolve(new Response(JSON.stringify({ id: messageId })));
    };
    await new ResendMailer('re_testonly', 'invites@example.com', undefined, transport).send(
      message,
      new AbortController().signal,
    );
    expect(options?.redirect).toBe('error');
    expect(JSON.parse(options?.body as string)).not.toHaveProperty('reply_to');
  });
  it('keeps the worker disabled by default and fails before DB access without sending settings', () => {
    expect(productionMailer(testConfig())).toBeInstanceOf(DisabledMailer);
    const base = {
      EMAIL_PROVIDER: 'resend',
      EMAIL_DELIVERY_ENABLED: 'true',
      EMAIL_PUBLIC_URL: 'https://app.example',
      EMAIL_UNSUBSCRIBE_SECRET: 's'.repeat(32),
    };
    expect(() => productionMailer(testConfig(base))).toThrow('EMAIL_FROM');
    expect(
      productionMailer(
        testConfig({ ...base, RESEND_API_KEY: 're_testonly', EMAIL_FROM: 'invites@example.com' }),
      ),
    ).toBeInstanceOf(ResendMailer);
    for (const settings of [
      { EMAIL_FROM: 'x\r\nbcc:a@example.com' },
      { RESEND_API_KEY: 'bad' },
      { RESEND_WEBHOOK_SECRET: 'bad' },
    ])
      expect(() => testConfig(settings)).toThrow();
  });
});

describe('Svix webhook verification', () => {
  const secret = 'whsec_' + Buffer.from('test-key-material-at-least-32bytes').toString('base64');
  const now = 1700000000000;
  const body = Buffer.from('{ "type": "email.bounced", "data": {} }');
  const sign = (timestamp = String(now / 1000), id = 'msg_test', payload = body) => ({
    id,
    timestamp,
    signature:
      'v1,' +
      createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
        .update(`${id}.${timestamp}.`)
        .update(payload)
        .digest('base64'),
  });
  it('accepts exact bytes and rotating signature lists', () => {
    expect(verifyResendWebhook(body, sign(), secret, now)).toBe(true);
    expect(
      verifyResendWebhook(
        body,
        { ...sign(), signature: 'v2,ignored v1,bad ' + sign().signature },
        secret,
        now,
      ),
    ).toBe(true);
  });
  it('rejects modified body, id, timestamp, key and old/future requests', () => {
    expect(verifyResendWebhook(Buffer.from('{}'), sign(), secret, now)).toBe(false);
    expect(verifyResendWebhook(body, { ...sign(), id: 'other' }, secret, now)).toBe(false);
    expect(
      verifyResendWebhook(body, { ...sign(), timestamp: String(now / 1000 + 1) }, secret, now),
    ).toBe(false);
    const wrongSecret =
      'whsec_' + Buffer.from('different-webhook-secret-material').toString('base64');
    expect(verifyResendWebhook(body, sign(), wrongSecret, now)).toBe(false);
    for (const delta of [-301, 301])
      expect(verifyResendWebhook(body, sign(String(now / 1000 + delta)), secret, now)).toBe(false);
  });
  it('rejects missing, oversized and malformed headers', () => {
    for (const headers of [
      {},
      { ...sign(), id: 'x'.repeat(201) },
      { ...sign(), timestamp: 'nan' },
      { ...sign(), signature: 'v1,' },
      { ...sign(), signature: 'v1,' + 'x'.repeat(2049) },
    ])
      expect(verifyResendWebhook(body, headers, secret, now)).toBe(false);
    expect(verifyResendWebhook(body, sign(), 'invalid', now)).toBe(false);
  });
});
