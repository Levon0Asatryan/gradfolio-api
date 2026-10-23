import { Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { ResendWebhookService } from './services/resend-webhook.service.js';

@Controller('email/webhooks')
export class ResendWebhookController {
  constructor(private readonly webhook: ResendWebhookService) {}

  @Public()
  @Post('resend')
  @HttpCode(200)
  @RateBudget('email')
  @Header('Cache-Control', 'no-store')
  receive(@Req() req: Request & { rawBody?: Buffer }) {
    return this.webhook.receive(req.rawBody, {
      id: req.get('svix-id'),
      timestamp: req.get('svix-timestamp'),
      signature: req.get('svix-signature'),
    });
  }
}
