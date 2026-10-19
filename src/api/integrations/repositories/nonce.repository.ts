import { sql } from 'kysely';
import type { Database } from '../../../core/db/database.js';

/**
 * Link nonces (docs/modules/m7/plan.md §2.3): only the SHA-256 of a nonce is stored,
 * bound to the user it was issued to, with an expiry.
 */

export async function insertNonce(
  db: Database,
  hash: string,
  userId: string,
  expiresAt: Date,
): Promise<void> {
  // Expired nonces of this user go first: they can never be consumed.
  await db
    .deleteFrom('integrationNonces')
    .where('userId', '=', userId)
    .where('expiresAt', '<=', sql<Date>`UTC_TIMESTAMP()`)
    .execute();
  await db.insertInto('integrationNonces').values({ hash, userId, expiresAt }).execute();
}

/**
 * Consumes a nonce: true only when it was this user's, unexpired and unused.
 * One statement, so of two requests with the same nonce exactly one deletes
 * the row (InnoDB's row lock orders them) and the other deletes nothing.
 */
export async function consumeNonce(db: Database, hash: string, userId: string): Promise<boolean> {
  const result = await db
    .deleteFrom('integrationNonces')
    .where('hash', '=', hash)
    .where('userId', '=', userId)
    .where('expiresAt', '>', sql<Date>`UTC_TIMESTAMP()`)
    .executeTakeFirst();
  return Number(result.numDeletedRows) === 1;
}
