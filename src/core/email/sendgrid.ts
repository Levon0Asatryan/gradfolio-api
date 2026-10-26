import { z } from 'zod';
import { MailDeliveryError, type EmailMessage, type Mailer } from './mailer.js';

const rejectionSchema = z.object({ errors: z.array(z.object({ message: z.string() })).min(1) });

export class SendGridMailer implements Mailer {
  // custom_args correlates events; SendGrid does not promise send deduplication.
  readonly idempotencyWindowMs = 0;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo?: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage, signal: AbortSignal): Promise<{ messageId: string }> {
    let response: Response;
    try {
      response = await this.transport('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: { email: this.from, name: 'Gradfolio' },
          ...(this.replyTo ? { reply_to: { email: this.replyTo } } : {}),
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
        }),
      });
    } catch {
      throw new Error('unknown mail delivery outcome');
    }
    // Accepted responses carry no JSON. A missing ID is still ambiguous.
    if (response.status === 202) {
      await response.body?.cancel().catch(() => undefined);
      const messageId = response.headers.get('x-message-id');
      if (!messageId || !/^[A-Za-z0-9_-]{1,200}$/.test(messageId))
        throw new Error('unknown mail delivery outcome');
      return { messageId };
    }
    const reader = response.body?.getReader();
    let body: unknown;
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4096) throw new Error('unknown mail delivery outcome');
          chunks.push(value);
        }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new Error('unknown mail delivery outcome');
    } finally {
      await reader?.cancel().catch(() => undefined);
    }
    const parsed = rejectionSchema.safeParse(body);
    if (!parsed.success) throw new Error('unknown mail delivery outcome');
    if (response.status === 429) throw new MailDeliveryError('temporary');
    if ([400, 401, 403, 404, 405, 413].includes(response.status))
      throw new MailDeliveryError('permanent');
    // No deduplication contract: never automatically retry 5xx/transport ambiguity.
    throw new Error('unknown mail delivery outcome');
  }
}
