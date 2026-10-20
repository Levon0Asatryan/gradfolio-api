import { Body, Controller, Get, Header, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG } from '../../core/config/config.module.js';
import type { AppConfig } from '../../core/config/schema.js';
import { DbService } from '../../core/db/db.service.js';
import { readUnsubscribeToken } from '../../core/email/unsubscribe.js';
import { AppError, NotFoundError } from '../../core/errors/app-error.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import { emailPreferencesPatchSchema, unsubscribeSchema } from './email.dto.js';

@Controller()
export class EmailController {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get('me/email-preferences')
  @Header('Cache-Control', 'private, no-store')
  async get(@CurrentUser() user: UserRow) {
    const row = await this.dbs.db
      .selectFrom('users')
      .select(['teamInviteEmailEnabled', 'preferredLanguage'])
      .where('id', '=', user.id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError('account');
    return {
      teamInvitesEnabled: row.teamInviteEmailEnabled,
      preferredLanguage: row.preferredLanguage,
    };
  }

  @Patch('me/email-preferences')
  @Header('Cache-Control', 'private, no-store')
  async patch(
    @CurrentUser() user: UserRow,
    @Body(zodBody(emailPreferencesPatchSchema)) input: z.infer<typeof emailPreferencesPatchSchema>,
  ) {
    const changed = await this.dbs.db
      .updateTable('users')
      .set({
        ...(input.teamInvitesEnabled !== undefined
          ? { teamInviteEmailEnabled: input.teamInvitesEnabled }
          : {}),
        ...(input.preferredLanguage !== undefined
          ? { preferredLanguage: input.preferredLanguage }
          : {}),
      })
      .where('id', '=', user.id)
      .executeTakeFirst();
    if (Number(changed.numUpdatedRows) === 0) throw new NotFoundError('account');
    return this.get(user);
  }

  @Public()
  @Post('email/unsubscribe')
  @HttpCode(200)
  @RateBudget('email')
  @Header('Cache-Control', 'no-store')
  async unsubscribe(@Body(zodBody(unsubscribeSchema)) input: z.infer<typeof unsubscribeSchema>) {
    if (!this.cfg.EMAIL_UNSUBSCRIBE_SECRET)
      throw new AppError('EMAIL_UNAVAILABLE', 'email settings unavailable', 503);
    const id = readUnsubscribeToken(input.token, this.cfg.EMAIL_UNSUBSCRIBE_SECRET);
    if (!id) throw new AppError('INVALID_UNSUBSCRIBE_TOKEN', 'link is invalid or expired', 400);
    await this.dbs.db
      .updateTable('users')
      .set({ teamInviteEmailEnabled: false })
      .where('id', '=', id)
      .execute();
    return { unsubscribed: true as const };
  }
}
