import { sql, type Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { DB } from '../../../core/db/types.generated.js';

/**
 * Lists `auth0Id` as deleted for `ttlS` seconds, and drops every entry that has
 * already expired (a row past `expires_at` is inert; the next deletion removes
 * it, so the table never outgrows the deletions of one token lifetime).
 * Run in the account-deletion transaction, after the user row is locked.
 */
export async function tombstoneSubject(
  trx: Transaction<DB>,
  auth0Id: string,
  ttlS: number,
): Promise<void> {
  await trx
    .deleteFrom('deletedSubjects')
    .where('expiresAt', '<=', sql<Date>`NOW()`)
    .execute();
  const expiresAt = sql<Date>`NOW() + INTERVAL ${ttlS} SECOND`;
  await trx
    .insertInto('deletedSubjects')
    .values({ auth0Id, expiresAt })
    .onDuplicateKeyUpdate({ expiresAt })
    .execute();
}

/**
 * Whether `auth0Id` is listed and unexpired. A locking read (`FOR SHARE`): it
 * sees the latest committed entry, not the transaction's snapshot, and a
 * deletion's insert of the same key queues behind it.
 */
export async function isTombstoned(trx: Transaction<DB>, auth0Id: string): Promise<boolean> {
  const row = await trx
    .selectFrom('deletedSubjects')
    .select('auth0Id')
    .where('auth0Id', '=', auth0Id)
    .where('expiresAt', '>', sql<Date>`NOW()`)
    .forShare()
    .executeTakeFirst();
  return row !== undefined;
}

/** Whether the tombstone table exists (the migration has run). */
export async function tombstoneTableExists(db: Database): Promise<boolean> {
  const { rows } = await sql<{ n: number }>`
    SELECT 1 AS n FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'deleted_subjects'
  `.execute(db);
  return rows.length > 0;
}
