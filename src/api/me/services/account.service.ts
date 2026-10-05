import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DbService } from '../../../core/db/db.service.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { NotFoundError } from '../../../core/errors/app-error.js';

@Injectable()
export class AccountService {
  constructor(
    private readonly dbs: DbService,
    @InjectPinoLogger(AccountService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Deletes the caller's account and everything under it (docs/m3-plan.md §5.3,
   * 3.6): profile sections, skills, projects with their attachments, tags and
   * team rows, integrations (tokens included), notifications and activities all
   * cascade (run, plan P6).
   *
   * Their membership rows on *other people's* projects stay as a name: the
   * foreign key sets `user_id` NULL, and `avatar_url` -- the person's photo --
   * is cleared first, because after the delete nothing can find the row.
   *
   * The Auth0 login is untouched (v1 decision): a token that is still valid
   * recreates a blank account on its next request (Q7), so the frontend signs
   * the user out after this call.
   *
   * The "started" line is written before the change, so the record of a
   * destructive action does not depend on the commit.
   */
  async delete(userId: string): Promise<void> {
    this.logger.info({ userId }, 'account deletion started');
    await inTransaction(this.dbs.db, async (trx) => {
      // No separate lock: the DELETE below takes the user row's own lock, so a
      // write in flight (which holds it) finishes first and its rows cascade away
      // (proved with a held lock in account.int.test.ts). Run: removing an
      // explicit `FOR UPDATE` here changes no outcome.
      await trx
        .updateTable('projectTeamMembers')
        .set({ avatarUrl: null })
        .where('userId', '=', userId)
        .execute();
      const result = await trx.deleteFrom('users').where('id', '=', userId).executeTakeFirst();
      if (Number(result.numDeletedRows) === 0) throw new NotFoundError('account');
    });
    this.logger.info({ userId }, 'account deletion completed');
  }
}
