import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import type { DB } from '../../../core/db/types.generated.js';
import { setUserSkills } from '../../../core/db/terms.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { ValidationError } from '../../../core/errors/app-error.js';
import { recordActivity } from '../../activities/repositories/activity-write.repository.js';
import { lockUser } from '../../../core/db/user-lock.js';

/** The most skills one save may announce; beyond it the save is a bulk edit and says nothing. */
const MAX_SKILL_ACTIVITIES = 3;

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
    return inTransaction(this.dbs.db, (trx) => this.replaceIn(trx, userId, names));
  }

  /** `replace` inside a transaction the caller owns (it takes the user lock itself). */
  async replaceIn(
    trx: Transaction<DB>,
    userId: string,
    names: readonly string[],
  ): Promise<string[]> {
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
    // A save that adds a few skills names each; one that adds more is setting a
    // profile up, not news, and writes none.
    const had = new Set(before.map((r) => r.skillName.toLowerCase()));
    const added = skills.filter((s) => !had.has(s.toLowerCase()));
    if (added.length <= MAX_SKILL_ACTIVITIES) {
      for (const skillName of added) await recordActivity(trx, userId, 'newSkill', { skillName });
    }
    return skills;
  }

  /**
   * Appends one skill to the caller's list, keeping the order of the rest, in the
   * caller's transaction. A skill already there (any case) changes nothing.
   */
  async addIn(trx: Transaction<DB>, userId: string, name: string): Promise<string[]> {
    await lockUser(trx, userId);
    const current = await trx
      .selectFrom('userSkills')
      .select('skillName')
      .where('userId', '=', userId)
      .orderBy('sortOrder')
      .execute();
    return this.replaceIn(trx, userId, [...current.map((r) => r.skillName), name]);
  }
}
