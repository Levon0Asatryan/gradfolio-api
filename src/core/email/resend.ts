import { z } from 'zod';
import type { AppConfig } from '../config/index.js';
import { DisabledMailer, MailDeliveryError, type EmailMessage, type Mailer } from './mailer.js';

const responseSchema = z.object({ id: z.uuid() });
const rejectionSchema = z.object({ name: z.string() });
const MAX_RESPONSE_BYTES = 4096;

/** Resend promises 24 hours; reserve a minute for clock/transport skew. */
export class ResendMailer implements Mailer {
  readonly idempotencyWindowMs = 86400_000 - 60_000;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo?: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage, signal: AbortSignal): Promise<{ messageId: string }> {
    // Do not leak fetch errors: implementations may put headers or payload in them.
    let response: Response;
    try {
      response = await this.transport('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: `Gradfolio <${this.from}>`,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(this.replyTo ? { reply_to: this.replyTo } : {}),
          tags: [{ name: 'outbox_id', value: message.idempotencyKey }],
        }),
      });
    } catch {
      throw new Error('unknown mail delivery outcome');
    }

    let body: unknown;
    const reader = response.body?.getReader();
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_RESPONSE_BYTES) throw new Error('oversized response');
          chunks.push(value);
        }
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new Error('unknown mail delivery outcome');
    } finally {
      await reader?.cancel().catch(() => undefined);
    }

    if (response.ok) {
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) throw new Error('unknown mail delivery outcome');
      return { messageId: parsed.data.id };
    }
    // A provider-named rejection is required. Unknown proxy/transport failures are
    // uncertain, even when they happen to carry a 4xx/5xx status.
    const rejection = rejectionSchema.safeParse(body);
    if (!rejection.success) throw new Error('unknown mail delivery outcome');
    const name = rejection.data.name;
    if (
      response.status === 429 &&
      ['rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded'].includes(name)
    )
      throw new MailDeliveryError('temporary');
    if (response.status >= 500 && ['application_error', 'service_unavailable'].includes(name))
      throw new MailDeliveryError('temporary');
    if (response.status === 409 && name === 'concurrent_idempotent_requests')
      throw new MailDeliveryError('temporary');
    if (
      response.status >= 400 &&
      response.status < 500 &&
      [
        'validation_error',
        'missing_required_field',
        'invalid_access',
        'restricted_api_key',
        'invalid_api_key',
        'missing_api_key',
        'invalid_parameter',
        'invalid_permission',
        'suspended_api_key',
        'invalid_idempotency_key',
        'invalid_region',
        'invalid_idempotent_request',
        'email_above_quota',
      ].includes(name)
    )
      throw new MailDeliveryError('permanent');
    throw new Error('unknown mail delivery outcome');
  }
}

/** Only the worker needs the sending credential; the API can serve with none. */
export function productionMailer(cfg: AppConfig): Mailer {
  if (!cfg.EMAIL_DELIVERY_ENABLED) return new DisabledMailer();
  if (!cfg.RESEND_API_KEY || !cfg.EMAIL_FROM)
    throw new Error('enabled mail worker needs RESEND_API_KEY and EMAIL_FROM');
  return new ResendMailer(cfg.RESEND_API_KEY, cfg.EMAIL_FROM, cfg.EMAIL_REPLY_TO);
}
