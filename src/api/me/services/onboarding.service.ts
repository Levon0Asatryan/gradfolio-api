import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DbService } from '../../../core/db/db.service.js';
import { NotFoundError } from '../../../core/errors/app-error.js';

@Injectable()
export class OnboardingService {
  constructor(private readonly dbs: DbService) {}

  /**
   * Marks first-login onboarding finished (or skipped). Idempotent: the first
   * timestamp is kept. 0 matched rows -- the account was deleted after the
   * guard resolved it -- is 404, never a success for a missing account.
   */
  async complete(userId: string): Promise<void> {
    const result = await this.dbs.db
      .updateTable('users')
      .set({ onboardedAt: sql`COALESCE(onboarded_at, UTC_TIMESTAMP())` })
      .where('id', '=', userId)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new NotFoundError('account');
  }
}
