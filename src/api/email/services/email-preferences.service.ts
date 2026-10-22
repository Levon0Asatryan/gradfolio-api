import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { readUnsubscribeToken } from '../../../core/email/unsubscribe.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import type { EmailPreferencesPatch } from '../dto/email.dto.js';
import {
  disableInvitationEmail,
  findEmailPreferences,
  patchEmailPreferences,
} from '../repositories/email-preferences.repository.js';

@Injectable()
export class EmailPreferencesService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async get(userId: string) {
    const row = await findEmailPreferences(this.dbs.db, userId);
    if (!row) throw new NotFoundError('account');
    return {
      teamInvitesEnabled: row.teamInviteEmailEnabled,
      preferredLanguage: row.preferredLanguage,
    };
  }

  async patch(userId: string, input: EmailPreferencesPatch) {
    const changed = await patchEmailPreferences(this.dbs.db, userId, input);
    if (Number(changed.numUpdatedRows) === 0) throw new NotFoundError('account');
    return this.get(userId);
  }

  async unsubscribe(token: string) {
    if (!this.cfg.EMAIL_UNSUBSCRIBE_SECRET)
      throw new AppError('EMAIL_UNAVAILABLE', 'email settings unavailable', 503);
    const id = readUnsubscribeToken(token, this.cfg.EMAIL_UNSUBSCRIBE_SECRET);
    if (!id) throw new AppError('INVALID_UNSUBSCRIBE_TOKEN', 'link is invalid or expired', 400);
    await disableInvitationEmail(this.dbs.db, id);
    return { unsubscribed: true as const };
  }
}
