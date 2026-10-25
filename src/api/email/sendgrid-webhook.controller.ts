import { Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { SendGridWebhookService } from './services/sendgrid-webhook.service.js';

@Controller('email/webhooks')
export class SendGridWebhookController {
  constructor(private readonly webhook: SendGridWebhookService) {}

  @Public()
  @Post('sendgrid')
  @HttpCode(200)
  @RateBudget('email')
  @Header('Cache-Control', 'no-store')
  receive(@Req() req: Request & { rawBody?: Buffer }) {
    return this.webhook.receive(req.rawBody, {
      timestamp: req.get('x-twilio-email-event-webhook-timestamp'),
      signature: req.get('x-twilio-email-event-webhook-signature'),
    });
  }
}
