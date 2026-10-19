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
 * The caller's row and whether their GitHub is connected, in one indexed read
 * (docs/modules/m7/plan.md §5.1): `verified` is "email verified or GitHub connected",
 * so the per-request re-sync needs both. A reservation (`'linking'`) does not
 * count.
 */
export async function findCaller(
  db: Executor,
  auth0Id: string,
): Promise<{ user: UserRow; githubConnected: boolean } | undefined> {
  const row = await db
    .selectFrom('users')
    .leftJoin('integrations as gh', (join) =>
      join
        .onRef('gh.userId', '=', 'users.id')
        .on('gh.integrationType', '=', 'github')
        .on('gh.status', '=', 'connected'),
    )
    .selectAll('users')
    .select(sql<number>`gh.id IS NOT NULL`.as('githubConnected'))
    .where('users.auth0Id', '=', auth0Id)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  const { githubConnected, ...user } = row;
  return { user, githubConnected: Number(githubConnected) === 1 };
}

/**
 * Whether another account has reserved or connected the GitHub account a
 * `github|<id>` subject signs in as (docs/modules/m7/plan.md §2.3). A locking read on
 * the `(integration_type, external_user_id)` key: with the link's locking read
 * of `users` by that subject, a provisioning and a link of the same GitHub
 * account cannot both commit (one waits, or InnoDB picks a deadlock victim
 * that `inTransaction` retries and that then sees the other's row).
 */
export async function githubIdTaken(trx: Transaction<DB>, githubId: string): Promise<boolean> {
  const row = await trx
    .selectFrom('integrations')
    .select('userId')
    .where('integrationType', '=', 'github')
    .where('externalUserId', '=', githubId)
    .forShare()
    .executeTakeFirst();
  return row !== undefined;
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
 * docs/modules/m2/plan.md §2.5).
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
 * Sets `verified` to the email's word OR a connected GitHub (D5), deciding
 * both under the user row lock: a connect or disconnect holds that lock for
 * its whole transaction, so the connection read here is the committed one and
 * this write cannot undo it. `undefined`: no such user (deleted meanwhile).
 */
export async function syncVerified(
  trx: Transaction<DB>,
  id: string,
  emailVerified: boolean,
): Promise<boolean | undefined> {
  const locked = await trx
    .selectFrom('users')
    .select('id')
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (locked === undefined) return undefined;
  const github = await trx
    .selectFrom('integrations')
    .select('id')
    .where('userId', '=', id)
    .where('integrationType', '=', 'github')
    .where('status', '=', 'connected')
    .forShare()
    .executeTakeFirst();
  const verified = emailVerified || github !== undefined;
  await trx
    .updateTable('users')
    .set({ verified })
    .where('id', '=', id)
    .where('verified', '<>', verified)
    .execute();
  return verified;
}
