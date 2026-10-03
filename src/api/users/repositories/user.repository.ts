import { type Selectable, sql, type Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import { newId } from '../../../core/db/ids.js';
import type { DB, Users } from '../../../core/db/types.generated.js';
import type { UserPrefill } from '../utils/prefill.js';

export type UserRow = Selectable<Users>;

type Executor = Database | Transaction<DB>;

/** A plain read by `auth0_id`: the fast path for every request after the first. */
export function findByAuth0Id(db: Executor, auth0Id: string): Promise<UserRow | undefined> {
  return db.selectFrom('users').selectAll().where('auth0Id', '=', auth0Id).executeTakeFirst();
}

/**
 * Creates the row for `auth0Id` unless one exists, and returns the row,
 * whoever inserted it. Run inside `inTransaction` (it retries the deadlock a
 * competitor's rollback can cause).
 *
 * `ON DUPLICATE KEY UPDATE id = id` changes nothing on an existing row, so a
 * login never overwrites what the user edited. The re-read is `FOR SHARE`: in
 * a transaction that has already read, a plain SELECT sees its old snapshot
 * and misses a row a competitor committed meanwhile (run: it returns no row;
 * docs/m2-plan.md §2.5).
 */
export async function upsertByAuth0Id(
  trx: Transaction<DB>,
  auth0Id: string,
  prefill: UserPrefill,
): Promise<UserRow> {
  await trx
    .insertInto('users')
    .values({
      id: newId(),
      auth0Id,
      name: prefill.name,
      email: prefill.email,
      avatarUrl: prefill.avatarUrl,
      headline: prefill.headline,
      verified: prefill.verified,
    })
    .onDuplicateKeyUpdate({ id: sql`id` })
    .execute();
  return trx
    .selectFrom('users')
    .selectAll()
    .where('auth0Id', '=', auth0Id)
    .forShare()
    .executeTakeFirstOrThrow();
}

/**
 * Brings `verified` in line with the token. Idempotent: a concurrent sync to
 * the same value changes nothing, and the condition makes a no-op cheap.
 */
export async function setVerified(db: Executor, id: string, verified: boolean): Promise<void> {
  await db
    .updateTable('users')
    .set({ verified })
    .where('id', '=', id)
    .where('verified', '<>', verified)
    .execute();
}
