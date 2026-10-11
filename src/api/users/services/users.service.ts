import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { DbService } from '../../../core/db/db.service.js';
import { inTransaction } from '../../../core/db/transaction.js';
import {
  findCaller,
  setVerified,
  type UserRow,
  upsertByAuth0Id,
} from '../repositories/user.repository.js';
import { hasProfileClaims, prefillFrom } from '../utils/prefill.js';

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
      user = await inTransaction(db, (trx) => upsertByAuth0Id(trx, identity.sub, prefill));
    }

    // A brand-new row has no integration yet.
    const verified = prefill.verified || found?.githubConnected === true;
    if (user.verified !== verified) {
      await setVerified(db, user.id, verified);
      user = { ...user, verified };
    }
    return user;
  }
}
