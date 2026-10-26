import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/index.js';
import { DbService } from '../../../core/db/db.service.js';
import { DisabledMailer } from '../../../core/email/mailer.js';
import {
  sendgridEventsSchema,
  verifySendGridWebhook,
} from '../../../core/email/sendgrid-webhook.js';
import { EmailWorker } from '../../../core/email/worker.js';
import { AppError } from '../../../core/errors/app-error.js';

@Injectable()
export class SendGridWebhookService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async receive(body: Buffer | undefined, headers: { timestamp?: string; signature?: string }) {
    if (!this.cfg.SENDGRID_WEBHOOK_PUBLIC_KEY)
      throw new AppError('EMAIL_UNAVAILABLE', 'email settings unavailable', 503);
    if (!body || !verifySendGridWebhook(body, headers, this.cfg.SENDGRID_WEBHOOK_PUBLIC_KEY))
      throw new AppError('INVALID_WEBHOOK_SIGNATURE', 'invalid webhook signature', 400);
    const events = sendgridEventsSchema.safeParse(JSON.parse(body.toString('utf8')) as unknown);
    if (
      !events.success ||
      events.data.some(
        (event) =>
          ['bounce', 'spamreport'].includes(event.event) && event.outbox_id && !event.sg_message_id,
      )
    )
      throw new AppError('INVALID_EMAIL_EVENT', 'invalid email event', 400);
    const worker = new EmailWorker(this.dbs.db, this.cfg, new DisabledMailer());
    // SendGrid's test events and unrelated account mail have no outbox argument.
    // Acknowledge them without changing any recipient or row.
    for (const event of events.data) {
      if (
        (event.event === 'bounce' || event.event === 'spamreport') &&
        event.outbox_id &&
        event.sg_message_id
      )
        await worker.recordFeedback(
          event.outbox_id,
          event.sg_message_id,
          event.event === 'bounce' ? 'bounced' : 'complained',
          'sendgrid',
        );
    }
    return { received: true as const };
  }
}
