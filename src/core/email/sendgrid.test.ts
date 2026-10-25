import { createServer, type Server } from 'node:http';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testConfig } from '../../testing/database.js';
import { DisabledMailer, MailDeliveryError } from './mailer.js';
import { SendGridMailer } from './sendgrid.js';
import { productionMailer } from './production-mailer.js';
import { verifySendGridWebhook } from './sendgrid-webhook.js';

let server: Server;
let origin: string;
let status = 202;
let body = '';
let messageId: string | undefined = 'sendgrid-message-id';
let captured: { authorization?: string; body?: unknown } = {};
const message = {
  to: 'invitee@example.com',
  subject: 'Թիմ',
  html: '<p>Թիմ</p>',
  text: 'Թիմ',
  idempotencyKey: randomUUID(),
};
const transport: typeof fetch = (_url, init) => fetch(origin, init);
const mailer = () =>
  new SendGridMailer('SG.test.key', 'sender@example.com', 'reply@example.com', transport);

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured = {
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString()) as unknown,
      };
      res.writeHead(status, {
        'content-type': 'application/json',
        ...(messageId ? { 'x-message-id': messageId } : {}),
      });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it('sends both body parts with correlation and tracking disabled; accepts empty 202 response', async () => {
  expect(await mailer().send(message, new AbortController().signal)).toEqual({ messageId });
  expect(captured.authorization).toBe('Bearer SG.test.key');
  expect(captured.body).toEqual({
    personalizations: [{ to: [{ email: message.to }] }],
    from: { email: 'sender@example.com', name: 'Gradfolio' },
    reply_to: { email: 'reply@example.com' },
    subject: message.subject,
    content: [
      { type: 'text/plain', value: message.text },
      { type: 'text/html', value: message.html },
    ],
    custom_args: { outbox_id: message.idempotencyKey },
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
    },
  });
  expect(mailer().idempotencyWindowMs).toBe(0);
});

it.each([400, 401, 403, 404, 405, 413, 429])(
  'classifies a documented %s rejection without leaking its body',
  async (code) => {
    status = code;
    body = JSON.stringify({ errors: [{ message: 'private provider data' }] });
    await expect(mailer().send(message, new AbortController().signal)).rejects.toMatchObject({
      kind: code === 429 ? 'temporary' : 'permanent',
      message: 'mail delivery failed',
    });
  },
);

it.each([
  [500, '{"errors":[{"message":"private"}]}'],
  [502, 'proxy'],
  [400, '{}'],
  [202, ''],
  [200, '{}'],
  [403, 'x'.repeat(4097)],
])('quarantines ambiguous %s responses', async (code, responseBody) => {
  status = Number(code);
  body = String(responseBody);
  messageId = undefined;
  const error: unknown = await mailer()
    .send(message, new AbortController().signal)
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(MailDeliveryError);
  expect((error as Error).message).toBe('unknown mail delivery outcome');
});

it('honors abort and fixes the provider endpoint without redirects', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(mailer().send(message, controller.signal)).rejects.toThrow(
    'unknown mail delivery outcome',
  );
  const transport: typeof fetch = (url, init) => {
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(init?.body as string)).not.toHaveProperty('reply_to');
    return Promise.resolve(new Response(null, { status: 202, headers: { 'x-message-id': 'abc' } }));
  };
  await new SendGridMailer('SG.test.key', 'sender@example.com', undefined, transport).send(
    message,
    new AbortController().signal,
  );
});

it('selects SendGrid by default, requires settings only when enabled and validates credentials', () => {
  expect(productionMailer(testConfig())).toBeInstanceOf(DisabledMailer);
  const enabled = {
    EMAIL_DELIVERY_ENABLED: 'true',
    EMAIL_PUBLIC_URL: 'https://app.example',
    EMAIL_UNSUBSCRIBE_SECRET: 's'.repeat(32),
  };
  expect(() => productionMailer(testConfig(enabled))).toThrow('EMAIL_FROM');
  expect(() =>
    productionMailer(testConfig({ ...enabled, EMAIL_FROM: 'sender@example.com' })),
  ).toThrow('SENDGRID_API_KEY');
  expect(
    productionMailer(
      testConfig({
        ...enabled,
        EMAIL_FROM: 'sender@example.com',
        SENDGRID_API_KEY: 'SG.testkey.testkey123456789',
      }),
    ),
  ).toBeInstanceOf(SendGridMailer);
  expect(() => testConfig({ SENDGRID_API_KEY: 'bad' })).toThrow();
  expect(() => testConfig({ SENDGRID_WEBHOOK_PUBLIC_KEY: 'bad' })).toThrow();
});

it('verifies real ECDSA signatures against raw bytes; rejects replay, modified payload, key and headers', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const key = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const payload = Buffer.from('[ { "event": "bounce", "subject": "Թիմ" } ]');
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const signature = sign(
    'sha256',
    Buffer.concat([Buffer.from(timestamp), payload]),
    privateKey,
  ).toString('base64');
  expect(verifySendGridWebhook(payload, { timestamp, signature }, key, now)).toBe(true);
  expect(verifySendGridWebhook(Buffer.from('[]'), { timestamp, signature }, key, now)).toBe(false);
  expect(verifySendGridWebhook(payload, { timestamp, signature }, key, now + 301000)).toBe(false);
  expect(verifySendGridWebhook(payload, { timestamp, signature }, key, now - 301000)).toBe(false);
  for (const headers of [
    {},
    { timestamp: 'nan', signature },
    { timestamp, signature: 'bad' },
    { timestamp, signature: 'x'.repeat(513) },
  ])
    expect(verifySendGridWebhook(payload, headers, key, now)).toBe(false);
  expect(verifySendGridWebhook(payload, { timestamp, signature }, 'invalid', now)).toBe(false);
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .publicKey.export({ format: 'der', type: 'spki' })
    .toString('base64');
  expect(verifySendGridWebhook(payload, { timestamp, signature }, other, now)).toBe(false);
});
