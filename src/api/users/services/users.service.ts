import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { UnauthenticatedError } from '../../../core/auth/errors.js';
import { isTombstoned, tombstoneTableExists } from '../repositories/deleted-subject.repository.js';
import {
  findCaller,
  githubIdTaken,
  syncVerified,
  type UserRow,
  upsertByAuth0Id,
} from '../repositories/user.repository.js';
import { hasProfileClaims, prefillFrom } from '../utils/prefill.js';

/** A GitHub login's subject, and the GitHub user id in it. */
const GITHUB_SUB = /^github\|([0-9]+)$/;

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectPinoLogger(UsersService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * `AUTH0_DELETE_USERS` is safe only with the deletion tombstone (docs/modules/m7/plan.md
   * §2.8): without its table, a still-valid access token would recreate a public
   * account for a user whose login is gone. So the API does not start.
   */
  async onModuleInit(): Promise<void> {
    if (this.cfg.AUTH0_DELETE_USERS && !(await tombstoneTableExists(this.dbs.db))) {
      throw new Error(
        'AUTH0_DELETE_USERS is on but the deleted_subjects table is missing: apply migration 0010_deleted_subjects',
      );
    }
  }

  /**
   * The caller's row, created on their first authenticated request (Q7,
   * docs/modules/m2/plan.md §3.4). A plain read first, outside any transaction; only a
   * miss pays for the race-safe upsert. Then `verified` follows the token's
   * `email_verified` or a connected GitHub (2.16, 7.12, docs/modules/m7/plan.md §5.1).
   *
   * With `AUTH0_DELETE_USERS`, a `sub` listed as deleted is refused (401) and
   * no row is created (§2.8). The check follows the upsert in the same
   * transaction and throws to roll it back: the upsert queues behind a deletion
   * holding the user row, and the deletion lists the `sub` before it commits, so
   * whichever order they run in, the row either is deleted with the account or
   * never commits. A check before the upsert would pass, then a deletion could
   * commit, then the upsert would create the row.
   */
  async resolve(identity: AccessTokenIdentity): Promise<UserRow> {
    const { db } = this.dbs;
    const prefill = prefillFrom(identity);

    const found = await findCaller(db, identity.sub);
    let user = found?.user;
    if (user === undefined) {
      if (!hasProfileClaims(identity)) {
        // Visible sign of a tenant without the claims Action; no values logged.
        this.logger.warn(
          { provider: identity.sub.split('|')[0] },
          'token carries no profile claims',
        );
      }
      const githubId = GITHUB_SUB.exec(identity.sub)?.[1];
      user = await inTransaction(db, async (trx) => {
        // A GitHub account another account reserved or connected is a login
        // Auth0 merges into that account: a row for it would be an orphan.
        if (githubId !== undefined && (await githubIdTaken(trx, githubId))) {
          throw new UnauthenticatedError('linked-elsewhere');
        }
        const created = await upsertByAuth0Id(trx, identity.sub, prefill);
        if (this.cfg.AUTH0_DELETE_USERS && (await isTombstoned(trx, identity.sub))) {
          throw new UnauthenticatedError('account-deleted');
        }
        return created;
      });
    }

    // A brand-new row has no integration yet. What was read above can be
    // stale by now (a connect may have committed), so a change is decided
    // again under the user lock, where connect and disconnect also write.
    const expected = prefill.verified || found?.githubConnected === true;
    if (user.verified !== expected) {
      const { id } = user;
      const settled = await inTransaction(db, (trx) => syncVerified(trx, id, prefill.verified));
      if (settled !== undefined) user = { ...user, verified: settled };
    }
    return user;
  }
}
