import type { Transaction } from 'kysely';
import type { DB } from '../../../core/db/types.generated.js';
import { NotFoundError } from '../../../core/errors/app-error.js';

/**
 * Takes the write lock on a user's row (`SELECT … FOR UPDATE`), the mutex for
 * every write that depends on the *set* of a user's rows: create (count and
 * position), reorder (exact set), replace-all skills, account deletion.
 *
 * Without it (run, docs/m3-plan.md §4.3): a reorder accepts a stale set; two
 * first-time skill replacements deadlock (1213); a create racing an account
 * deletion fails with a foreign-key error (1452).
 *
 * Lock order everywhere: this row, then the section rows, then `terms`. The
 * row is gone when the account was deleted meanwhile: 404, not an FK error.
 */
export async function lockUser(trx: Transaction<DB>, userId: string): Promise<void> {
  const row = await trx
    .selectFrom('users')
    .select('id')
    .where('id', '=', userId)
    .forUpdate()
    .executeTakeFirst();
  if (row === undefined) throw new NotFoundError('account');
}
