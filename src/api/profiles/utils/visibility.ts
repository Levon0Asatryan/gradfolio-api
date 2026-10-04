import type { ExpressionBuilder } from 'kysely';
import type { DB } from '../../../core/db/types.generated.js';

/**
 * Who may read a profile (Q3, option A, decided by Levon in M3): a public
 * profile is readable by anyone, a private one only by its owner. Anonymous
 * callers and other users get no row, so the route answers 404 exactly as it
 * does for an id that does not exist.
 *
 * The one place this policy lives. It is a predicate in the SQL, not a check
 * after the fetch, so a private row never leaves the database for a caller who
 * may not see it. Search and browse (M6) reuse it; changing Q3 changes this
 * function and its tests.
 */
export function visibleTo(eb: ExpressionBuilder<DB, 'users'>, viewerId: string | undefined) {
  const isPublic = eb('users.isPublic', '=', true);
  return viewerId === undefined ? isPublic : eb.or([isPublic, eb('users.id', '=', viewerId)]);
}
