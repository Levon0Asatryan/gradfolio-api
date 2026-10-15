import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { DbService } from '../../../core/db/db.service.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { UnauthenticatedError } from '../../../core/auth/errors.js';
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
export class UsersService {
  constructor(
    private readonly dbs: DbService,
    @InjectPinoLogger(UsersService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * The caller's row, created on their first authenticated request (Q7,
   * docs/m2-plan.md §3.4). A plain read first, outside any transaction; only a
   * miss pays for the race-safe upsert. Then `verified` follows the token's
   * `email_verified` or a connected GitHub (2.16, 7.12, docs/m7-plan.md §5.1).
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
        return upsertByAuth0Id(trx, identity.sub, prefill);
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
