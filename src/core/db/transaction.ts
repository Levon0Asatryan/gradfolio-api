import type { Transaction } from 'kysely';
import type { Database } from './database.js';
import { isMysqlError, MysqlErrno } from './mysql-errors.js';
import type { DB } from './types.generated.js';

/** Runs one attempt; a 1213 anywhere inside means InnoDB rolled all of it back. */
export type TransactionWork<T> = (trx: Transaction<DB>) => Promise<T>;

/**
 * Runs `work` in a transaction, retrying the whole transaction when InnoDB
 * picks it as a deadlock victim (1213) -- the server's own advice ("try
 * restarting transaction"), bounded by `maxAttempts`.
 *
 * Needed even for single-row upserts: when a competing insert of the same
 * unique key rolls back, InnoDB deadlocks one of the waiters whatever the SQL
 * (ON DUPLICATE KEY UPDATE, INSERT IGNORE, or INSERT + catch 1062; run).
 * `work` must be safe to repeat: it runs again from the start.
 */
export async function inTransaction<T>(
  db: Database,
  work: TransactionWork<T>,
  { maxAttempts = 3 }: { maxAttempts?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction().execute(work);
    } catch (err) {
      if (attempt >= maxAttempts || !isMysqlError(err, MysqlErrno.DEADLOCK)) throw err;
    }
  }
}
