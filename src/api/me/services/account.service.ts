import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DbService } from '../../../core/db/db.service.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { lockUser } from '../../../core/db/user-lock.js';
import { FileUrlService } from '../../files/services/file-url.service.js';

/** More than the per-user cap can ever hold (config max 5000). */
const ACCOUNT_FILE_LIMIT = 10_000;

@Injectable()
export class AccountService {
  constructor(
    private readonly dbs: DbService,
    @InjectPinoLogger(AccountService.name) private readonly logger: PinoLogger,
    private readonly files: FileUrlService,
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
      // The user row first, as everywhere (docs/m3-plan.md §1: user row, then
      // child rows). Without it this transaction locks the team rows first and
      // then waits for the user row, while a write that follows the documented
      // order holds the user row and waits for a team row: a deadlock (run,
      // account.int.test.ts). It also queues behind writes in flight, and the
      // not-found case is a 404.
      await lockUser(trx, userId);
      await trx
        .updateTable('projectTeamMembers')
        .set({ avatarUrl: null })
        .where('userId', '=', userId)
        .execute();
      const result = await trx.deleteFrom('users').where('id', '=', userId).executeTakeFirst();
      if (Number(result.numDeletedRows) === 0) throw new NotFoundError('account');
    });
    // Every object under the user's prefix, including uploads never registered.
    // After the commit: a failed delete is logged by `release` and swept later.
    await this.files.releaseAllOf(userId, ACCOUNT_FILE_LIMIT);
    this.logger.info({ userId }, 'account deletion completed');
  }
}
