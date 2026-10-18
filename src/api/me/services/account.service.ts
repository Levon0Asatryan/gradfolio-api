import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DbService } from '../../../core/db/db.service.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { lockUser } from '../../../core/db/user-lock.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import { GithubConnectionService } from '../../integrations/services/github-connection.service.js';
import type { UserRow } from '../../users/repositories/user.repository.js';

/** More than the per-user cap can ever hold (config max 5000). */
const ACCOUNT_FILE_LIMIT = 10_000;

@Injectable()
export class AccountService {
  constructor(
    private readonly dbs: DbService,
    @InjectPinoLogger(AccountService.name) private readonly logger: PinoLogger,
    private readonly files: FileUrlService,
    private readonly github: GithubConnectionService,
  ) {}

  /**
   * Deletes the caller's account and everything under it (docs/modules/m3/plan.md §5.3,
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
   * A GitHub connection is revoked at GitHub first (docs/m7-plan.md D9): the
   * token Auth0 holds dies with the account. A failed revocation stops the
   * deletion before anything is deleted (502 GITHUB_REVOKE_FAILED), and so
   * does a connection made between the revocation and the user lock (409
   * GITHUB_STATE_CHANGED): its grant was never revoked.
   *
   * The "started" line is written before the change, so the record of a
   * destructive action does not depend on the commit.
   */
  async delete(user: UserRow): Promise<void> {
    const userId = user.id;
    this.logger.info({ userId }, 'account deletion started');
    const revoked = await this.github.revokeBeforeAccountDeletion(user);
    await inTransaction(this.dbs.db, async (trx) => {
      // The user row first, as everywhere (docs/modules/m3/plan.md §1: user row, then
      // child rows). Without it this transaction locks the team rows first and
      // then waits for the user row, while a write that follows the documented
      // order holds the user row and waits for a team row: a deadlock (run,
      // account.int.test.ts). It also queues behind writes in flight, and the
      // not-found case is a 404.
      await lockUser(trx, userId);
      await this.github.assertRevokedForDeletion(trx, userId, revoked);
      await trx
        .updateTable('projectTeamMembers')
        .set({ avatarUrl: null })
        .where('userId', '=', userId)
        .execute();
      // An invitation nobody answered (or that was declined) has nothing to keep:
      // the foreign key would turn it into a nameless pending row (docs/modules/m5/plan §2.4).
      await trx
        .deleteFrom('projectTeamMembers')
        .where('userId', '=', userId)
        .where('status', '<>', 'accepted')
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
