import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { setUserSkills } from '../../../core/db/terms.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { ValidationError } from '../../../core/errors/app-error.js';
import { lockUser } from '../../../core/db/user-lock.js';

@Injectable()
export class SkillsService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * Replaces the caller's whole skill list, in the order given, in one
   * transaction under the user lock: a competing replacement waits (instead of
   * deadlocking) and the result is exactly one caller's list, never a mix.
   * The cap is checked on the canonical, de-duplicated list *inside* the
   * transaction, so an over-long request rolls back whole -- the old list and
   * the registry are untouched.
   */
  replace(userId: string, names: readonly string[]): Promise<string[]> {
    return inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      const skills = await setUserSkills(trx, userId, names);
      if (skills.length > this.cfg.PROFILE_MAX_SKILLS) {
        throw new ValidationError([
          { path: 'skills', message: `at most ${this.cfg.PROFILE_MAX_SKILLS} skills are allowed` },
        ]);
      }
      return skills;
    });
  }
}
