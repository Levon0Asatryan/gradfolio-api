import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { setUserSkills } from '../../../core/db/terms.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { ValidationError } from '../../../core/errors/app-error.js';
import { recordActivity } from '../../activities/repositories/activity-write.repository.js';
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
      const before = await trx
        .selectFrom('userSkills')
        .select('skillName')
        .where('userId', '=', userId)
        .execute();
      const skills = await setUserSkills(trx, userId, names);
      if (skills.length > this.cfg.PROFILE_MAX_SKILLS) {
        throw new ValidationError([
          { path: 'skills', message: `at most ${this.cfg.PROFILE_MAX_SKILLS} skills are allowed` },
        ]);
      }
      // News is what was added (names compare case-insensitively, like the registry).
      // One new skill is named; several are counted, so first-time setup is one line.
      const had = new Set(before.map((r) => r.skillName.toLowerCase()));
      const added = skills.filter((s) => !had.has(s.toLowerCase()));
      if (added.length === 1) await recordActivity(trx, userId, 'newSkill', { skill: added[0]! });
      else if (added.length > 1) {
        await recordActivity(trx, userId, 'skillsAdded', { count: added.length });
      }
      return skills;
    });
  }
}
