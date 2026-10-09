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

/**
 * An accepted member of the project, as a predicate on `projects`: the viewer
 * has a team row on it with status `accepted`. Pending and rejected rows grant
 * nothing (docs/m5-plan.md §2).
 */
export function isAcceptedMember(eb: ExpressionBuilder<DB, 'projects'>, userId: string) {
  return eb.exists(
    eb
      .selectFrom('projectTeamMembers as m')
      .select('m.id')
      .whereRef('m.projectId', '=', 'projects.id')
      .where('m.userId', '=', userId)
      .where('m.status', '=', 'accepted'),
  );
}

/**
 * Who may read **one project by id** (Q4, docs/m5-plan.md §2.3): everything
 * `projectVisibleTo` allows, plus an accepted team member of a project that is
 * not a draft (private included). A pending or rejected invitee, a removed
 * member and a stranger get no row.
 *
 * Direct reads only. Lists, search and browse (M6) are discovery: they use
 * `projectVisibleTo` / `isPublished`, never this, so membership never makes a
 * private project show up in someone else's results.
 */
export function projectReadableBy(
  eb: ExpressionBuilder<DB, 'projects'>,
  viewerId: string | undefined,
) {
  const base = projectVisibleTo(eb, viewerId);
  if (viewerId === undefined) return base;
  return eb.or([
    base,
    eb.and([eb('projects.isDraft', '=', false), isAcceptedMember(eb, viewerId)]),
  ]);
}
