import { type Selectable, sql, type Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import { newId } from '../../../core/db/ids.js';
import type { DB, Integrations } from '../../../core/db/types.generated.js';

/**
 * The caller's `integrations` rows (docs/m7-plan.md §2.6). Every statement is
 * scoped to one `user_id`; no token column is ever written (0008's CHECK, and
 * the row types take only NULL there).
 */

type Executor = Database | Transaction<DB>;

export type IntegrationRow = Pick<
  Selectable<Integrations>,
  | 'id'
  | 'integrationType'
  | 'status'
  | 'generation'
  | 'externalUserId'
  | 'externalLogin'
  | 'lastSyncedAt'
>;

const COLUMNS = [
  'id',
  'integrationType',
  'status',
  'generation',
  'externalUserId',
  'externalLogin',
  'lastSyncedAt',
] as const;

/**
 * The version of the caller's GitHub row a transition read before its outside
 * calls (GitHub, Auth0), or null when there was no row. Every write bumps the
 * generation, so a write committed in between, even within the same second,
 * shows as a different version under the lock.
 */
export function versionOf(row: IntegrationRow | undefined): number | null {
  return row === undefined ? null : row.generation;
}
/** The caller's rows, one per type at most (`UNIQUE (user_id, integration_type)`). */
export function integrationsOf(db: Executor, userId: string): Promise<IntegrationRow[]> {
  return db.selectFrom('integrations').select(COLUMNS).where('userId', '=', userId).execute();
}

/** The caller's GitHub row, locked; call after `lockUser` in the same transaction. */
export function lockGithubRow(
  trx: Transaction<DB>,
  userId: string,
): Promise<IntegrationRow | undefined> {
  return trx
    .selectFrom('integrations')
    .select(COLUMNS)
    .where('userId', '=', userId)
    .where('integrationType', '=', 'github')
    .forUpdate()
    .executeTakeFirst();
}

export interface GithubRowValues {
  status: 'connected' | 'not_connected' | 'linking';
  externalUserId: string | null;
  externalLogin: string | null;
}

/**
 * Writes the caller's GitHub row under the user lock: an UPDATE of the row
 * when it exists, else an INSERT.
 *
 * Deliberately not `INSERT … ON DUPLICATE KEY UPDATE`: the table has two
 * unique keys, and when the insert collides with another user's row on
 * `(integration_type, external_user_id)`, MySQL applies the UPDATE to *that*
 * row, so one student's link would rewrite another's. Here a collision is a
 * 1062 the caller turns into 409 GITHUB_ACCOUNT_IN_USE.
 *
 * `updated_at` is set explicitly: a reservation's age is what reconciliation
 * reads, and MySQL refreshes it only when another column changes. The
 * generation goes up by one with every write (`existing` is the locked row,
 * so the number returned is the one stored).
 */
export async function writeGithubRow(
  trx: Transaction<DB>,
  userId: string,
  existing: IntegrationRow | undefined,
  values: GithubRowValues,
  { clearSynced = false }: { clearSynced?: boolean } = {},
): Promise<number> {
  const row = {
    ...values,
    updatedAt: sql<Date>`UTC_TIMESTAMP()`,
    ...(clearSynced ? { lastSyncedAt: null } : {}),
  };
  if (existing) {
    await trx
      .updateTable('integrations')
      .set({ ...row, generation: sql<number>`generation + 1` })
      .where('id', '=', existing.id)
      .where('userId', '=', userId)
      .execute();
    return existing.generation + 1;
  }
  await trx
    .insertInto('integrations')
    .values({ id: newId(), userId, integrationType: 'github', generation: 1, ...row })
    .execute();
  return 1;
}

/**
 * The caller's reservation when it is older than `olderThanS` seconds: a link
 * whose Auth0 call has certainly ended (plan §2.3). DB time on both sides:
 * `updated_at` is written by MySQL in the session's UTC.
 */
export function staleReservation(
  db: Executor,
  userId: string,
  olderThanS: number,
  { lock = false }: { lock?: boolean } = {},
): Promise<IntegrationRow | undefined> {
  const query = db
    .selectFrom('integrations')
    .select(COLUMNS)
    .where('userId', '=', userId)
    .where('integrationType', '=', 'github')
    .where('status', '=', 'linking')
    .where('updatedAt', '<', sql<Date>`UTC_TIMESTAMP() - INTERVAL ${olderThanS} SECOND`);
  // Locked, the read sees the latest commit rather than the transaction's snapshot.
  return (lock ? query.forUpdate() : query).executeTakeFirst();
}

/**
 * Whether a Gradfolio account signs in as `auth0Id` (the secondary GitHub
 * login). A locking read: it holds the `auth0_id` key (or its gap) until the
 * reservation commits, so a first login as that subject cannot be provisioned
 * in between (provisioning makes the matching read of the reservation's key;
 * users/repositories/user.repository.ts `githubIdTaken`).
 */
export async function accountExists(trx: Transaction<DB>, auth0Id: string): Promise<boolean> {
  const row = await trx
    .selectFrom('users')
    .select('id')
    .where('auth0Id', '=', auth0Id)
    .forShare()
    .executeTakeFirst();
  return row !== undefined;
}

/** `users.verified`, in the transaction that changes what it depends on (plan §5.1). */
export async function setUserVerified(
  trx: Transaction<DB>,
  userId: string,
  verified: boolean,
): Promise<void> {
  await trx.updateTable('users').set({ verified }).where('id', '=', userId).execute();
}
