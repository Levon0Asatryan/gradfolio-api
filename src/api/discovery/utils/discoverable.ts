import type { ExpressionBuilder } from 'kysely';
import type { DB } from '../../../core/db/types.generated.js';
import { visibleTo } from '../../profiles/utils/visibility.js';
import { projectVisibleTo } from '../../projects/utils/visibility.js';

/**
 * What discovery may show (docs/m6-plan.md §2.5, §4.1): search, tags, browse and
 * the tag cloud. The one place M6 composes visibility, so a new endpoint cannot
 * forget a predicate.
 *
 * Q3 = A: a private profile or project is excluded from search and browse, and
 * so is a draft. The viewer is deliberately **not** a parameter: discovery is the
 * same for everyone, the owner included (N1). Their own private work is theirs
 * to find through `/me/projects`, and a response that does not depend on the
 * viewer can be cached.
 */

/** A published project: public and not a draft (`projectVisibleTo` with no viewer). */
export const discoverableProject = (eb: ExpressionBuilder<DB, 'projects'>) =>
  projectVisibleTo(eb, undefined);

/** A public profile (the Q3 rule with no viewer). */
export const discoverableUser = (eb: ExpressionBuilder<DB, 'users'>) => visibleTo(eb, undefined);

/**
 * The owner side of a project card, for a query that joins `users as owner`:
 * a published project of a **private** profile is not discoverable, because
 * its card would carry the private user's name and picture (D5). Direct reads
 * of the project are unchanged (M4).
 */
export const discoverableOwner = (eb: ExpressionBuilder<DB & { owner: DB['users'] }, 'owner'>) =>
  eb('owner.isPublic', '=', true);
