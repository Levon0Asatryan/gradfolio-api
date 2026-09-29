import { sql, type Transaction } from 'kysely';
import { normalizeTerm } from '../validation/terms.js';
import { newId } from './ids.js';
import type { DB } from './types.generated.js';

/**
 * The canonical spelling of each name, registering new ones.
 *
 * `terms` is keyed case-insensitively (its collation), so `React` and `react`
 * are one key: the first spelling to reach it wins, and every writer gets that
 * spelling back. The read is `FOR SHARE`: in a transaction that has already
 * read, a plain SELECT sees its old snapshot and would miss a spelling another
 * transaction committed meanwhile (run: it returns no row).
 *
 * Names are registered in one fixed order (case-insensitively sorted), so two
 * transactions registering the same names cannot lock them in opposite orders.
 * A competing registration that rolls back can still deadlock a waiter (1213);
 * run the caller in `inTransaction`, which retries.
 */
export async function canonicalizeTerms(
  trx: Transaction<DB>,
  names: readonly string[],
): Promise<string[]> {
  const normalized = names.map(normalizeTerm).filter((n) => n.length > 0);
  const order = [...new Set(normalized)].sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0,
  );

  const canonical = new Map<string, string>();
  for (const name of order) {
    await trx
      .insertInto('terms')
      .values({ name })
      .onDuplicateKeyUpdate({ name: sql`name` })
      .execute();
    const row = await trx
      .selectFrom('terms')
      .select('name')
      .where('name', '=', name)
      .forShare()
      .executeTakeFirstOrThrow();
    canonical.set(name, row.name);
  }
  return normalized.map((n) => canonical.get(n)!);
}

/** First occurrence of each canonical spelling, in order. */
function unique(names: string[]): string[] {
  return [...new Set(names)];
}

/**
 * Replaces a project's technologies or tags with `names`, canonicalized, in
 * the given order. Does not check who owns the project: callers scope that.
 */
export async function setProjectTerms(
  trx: Transaction<DB>,
  projectId: string,
  kind: 'technologies' | 'tags',
  names: readonly string[],
): Promise<string[]> {
  const table = kind === 'technologies' ? 'projectTechnologies' : 'projectTags';
  const canonical = unique(await canonicalizeTerms(trx, names));
  await trx.deleteFrom(table).where('projectId', '=', projectId).execute();
  if (canonical.length > 0) {
    await trx
      .insertInto(table)
      .values(canonical.map((name, sortOrder) => ({ projectId, name, sortOrder })))
      .execute();
  }
  return canonical;
}

/** Replaces a user's skills with `names`, canonicalized, in the given order. */
export async function setUserSkills(
  trx: Transaction<DB>,
  userId: string,
  names: readonly string[],
): Promise<string[]> {
  const canonical = unique(await canonicalizeTerms(trx, names));
  await trx.deleteFrom('userSkills').where('userId', '=', userId).execute();
  if (canonical.length > 0) {
    await trx
      .insertInto('userSkills')
      .values(
        canonical.map((skillName, sortOrder) => ({ id: newId(), userId, skillName, sortOrder })),
      )
      .execute();
  }
  return canonical;
}
