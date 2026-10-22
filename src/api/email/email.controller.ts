import { Body, Controller, Get, Header, HttpCode, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/decorators/public.decorator.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import { emailPreferencesPatchSchema, unsubscribeSchema } from './dto/email.dto.js';
import { EmailPreferencesService } from './services/email-preferences.service.js';

@Controller()
export class EmailController {
  constructor(private readonly preferences: EmailPreferencesService) {}

  @Get('me/email-preferences')
  @Header('Cache-Control', 'private, no-store')
  async get(@CurrentUser() user: UserRow) {
    return this.preferences.get(user.id);
  }

  @Patch('me/email-preferences')
  @Header('Cache-Control', 'private, no-store')
  async patch(
    @CurrentUser() user: UserRow,
    @Body(zodBody(emailPreferencesPatchSchema)) input: z.infer<typeof emailPreferencesPatchSchema>,
  ) {
    return this.preferences.patch(user.id, input);
  }

  @Public()
  @Post('email/unsubscribe')
  @HttpCode(200)
  @RateBudget('email')
  @Header('Cache-Control', 'no-store')
  async unsubscribe(@Body(zodBody(unsubscribeSchema)) input: z.infer<typeof unsubscribeSchema>) {
    return this.preferences.unsubscribe(input.token);
  }
}
