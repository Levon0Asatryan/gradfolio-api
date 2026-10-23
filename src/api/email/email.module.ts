import { Module } from '@nestjs/common';
import { EmailController } from './email.controller.js';
import { EmailPreferencesService } from './services/email-preferences.service.js';
import { ResendWebhookController } from './resend-webhook.controller.js';
import { ResendWebhookService } from './services/resend-webhook.service.js';

@Module({
  controllers: [EmailController, ResendWebhookController],
  providers: [EmailPreferencesService, ResendWebhookService],
})
export class EmailModule {}
