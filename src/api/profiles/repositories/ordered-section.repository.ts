import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { DB } from '../../../core/db/types.generated.js';

/**
 * What the three ordered profile sections share: a `user_id` owner and a
 * `sort_order`. Every statement is scoped by `user_id` in its own WHERE.
 *
 * The tables differ in their other columns, which these helpers never touch,
 * so they see each table through this minimal shape instead of triplicating
 * the code. (M4 reuses `applyOrder` for attachments with a project owner.)
 */
export type SectionTable = 'education' | 'experience' | 'certifications' | 'projectAttachments';

/** The column that names a row's owner: a user for sections, a project for attachments. */
export type OwnerColumn = 'userId' | 'projectId';

interface Common {
  id: string;
  userId: string;
  projectId: string;
  sortOrder: number;
}
type Loose = Kysely<Record<SectionTable, Common>>;

const loose = (db: Database | Transaction<DB>) => db as unknown as Loose;

export async function countOwned(
  trx: Transaction<DB>,
  table: SectionTable,
  userId: string,
  owner: OwnerColumn = 'userId',
): Promise<number> {
  const row = await loose(trx)
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where(owner, '=', userId)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** A sort_order that places a new row first: one below the smallest, or 0. */
export async function topSortOrder(
  trx: Transaction<DB>,
  table: SectionTable,
  userId: string,
  owner: OwnerColumn = 'userId',
): Promise<number> {
  const row = await loose(trx)
    .selectFrom(table)
    .select((eb) => eb.fn.min<number | null>('sortOrder').as('lowest'))
    .where(owner, '=', userId)
    .executeTakeFirstOrThrow();
  return row.lowest === null ? 0 : Number(row.lowest) - 1;
}

/** The caller's ids, locked (`FOR UPDATE`) until the transaction ends. */
export async function lockOwnedIds(
  trx: Transaction<DB>,
  table: SectionTable,
  userId: string,
  owner: OwnerColumn = 'userId',
): Promise<string[]> {
  const rows = await loose(trx)
    .selectFrom(table)
    .select('id')
    .where(owner, '=', userId)
    .forUpdate()
    .execute();
  return rows.map((r) => r.id);
}

/** Rows deleted: 0 means no such entry of the caller's. */
export async function deleteOwned(
  db: Database,
  table: SectionTable,
  userId: string,
  id: string,
  owner: OwnerColumn = 'userId',
): Promise<number> {
  const result = await loose(db)
    .deleteFrom(table)
    .where('id', '=', id)
    .where(owner, '=', userId)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

/**
 * Writes `sort_order = position` for `ids` in one statement, only on rows that
 * are the caller's. Returns the rows matched; the caller compares it with
 * `ids.length` and rolls back on a difference.
 */
export async function applyOrder(
  trx: Transaction<DB>,
  table: SectionTable,
  userId: string,
  ids: readonly string[],
  owner: OwnerColumn = 'userId',
): Promise<number> {
  if (ids.length === 0) return 0;
  const position = sql<number>`CASE id ${sql.join(
    ids.map((id, i) => sql`WHEN ${id} THEN ${i}`),
    sql` `,
  )} END`;
  const result = await loose(trx)
    .updateTable(table)
    .set({ sortOrder: position })
    .where(owner, '=', userId)
    .where('id', 'in', ids as string[])
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}
