import type { ExpressionBuilder } from 'kysely';
import type { DB } from '../../../core/db/types.generated.js';

/**
 * Who may read a project (Q3, option A, applied to projects): a published
 * project (public and not a draft) is readable by anyone, anything else only by
 * its owner. Anonymous callers and other users get no row, so the route answers
 * 404 exactly as it does for an id that does not exist.
 *
 * The one place this policy lives. It is a predicate in the SQL, not a check
 * after the fetch, so a private row never leaves the database for a caller who
 * may not see it. Search and browse (M6) reuse it.
 */
export function projectVisibleTo(
  eb: ExpressionBuilder<DB, 'projects'>,
  viewerId: string | undefined,
) {
  const published = isPublished(eb);
  return viewerId === undefined
    ? published
    : eb.or([published, eb('projects.userId', '=', viewerId)]);
}

/** Public and not a draft: what everyone may see, the owner included when listing a user's work. */
export function isPublished(eb: ExpressionBuilder<DB, 'projects'>) {
  return eb.and([eb('projects.isPublic', '=', true), eb('projects.isDraft', '=', false)]);
}
