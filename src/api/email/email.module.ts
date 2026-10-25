import { Module } from '@nestjs/common';
import { EmailController } from './email.controller.js';
import { EmailPreferencesService } from './services/email-preferences.service.js';
import { ResendWebhookController } from './resend-webhook.controller.js';
import { ResendWebhookService } from './services/resend-webhook.service.js';
import { SendGridWebhookController } from './sendgrid-webhook.controller.js';
import { SendGridWebhookService } from './services/sendgrid-webhook.service.js';

@Module({
  controllers: [EmailController, ResendWebhookController, SendGridWebhookController],
  providers: [EmailPreferencesService, ResendWebhookService, SendGridWebhookService],
})
export class EmailModule {}
