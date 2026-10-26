import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/index.js';
import { DbService } from '../../../core/db/db.service.js';
import { DisabledMailer } from '../../../core/email/mailer.js';
import { resendEventSchema, verifyResendWebhook } from '../../../core/email/resend-webhook.js';
import { EmailWorker } from '../../../core/email/worker.js';
import { AppError } from '../../../core/errors/app-error.js';

@Injectable()
export class ResendWebhookService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async receive(
    body: Buffer | undefined,
    headers: { id?: string; timestamp?: string; signature?: string },
  ) {
    if (!this.cfg.RESEND_WEBHOOK_SECRET)
      throw new AppError('EMAIL_UNAVAILABLE', 'email settings unavailable', 503);
    if (!body || !verifyResendWebhook(body, headers, this.cfg.RESEND_WEBHOOK_SECRET))
      throw new AppError('INVALID_WEBHOOK_SIGNATURE', 'invalid webhook signature', 400);
    // The HTTP JSON parser already rejected malformed JSON; reparse the signed
    // bytes so no transformed/unsigned object can reach the feedback handler.
    const event = resendEventSchema.safeParse(JSON.parse(body.toString('utf8')) as unknown);
    if (!event.success) throw new AppError('INVALID_EMAIL_EVENT', 'invalid email event', 400);
    const { type, data } = event.data;
    if (type === 'email.bounced' || type === 'email.complained') {
      const rowId = z.uuid().safeParse(data.tags?.outbox_id);
      if (!rowId.success || !data.email_id)
        throw new AppError('INVALID_EMAIL_EVENT', 'invalid email event', 400);
      await new EmailWorker(this.dbs.db, this.cfg, new DisabledMailer()).recordFeedback(
        rowId.data,
        data.email_id,
        type === 'email.bounced' ? 'bounced' : 'complained',
      );
    }
    return { received: true as const };
  }
}
