import { sql } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import { discoverableOwner, discoverableProject, discoverableUser } from '../utils/discoverable.js';
import { escapeLike } from '../utils/search-query.js';

/**
 * Typeahead (docs/m6-plan.md §3, the suggestions endpoint). Prefix and word-start
 * `LIKE` only, so a single letter works and a stopword is not special; every
 * group starts from the discoverable predicates, and every list is at most
 * `limit` rows of the columns named here. The text is bound, with `%`, `_` and
 * `\` escaped.
 */

/** Best first: the whole name, then names that start with it, then names with a word that does. */
const rank = (column: string, text: string) =>
  sql<number>`(CASE WHEN ${sql.ref(column)} = ${text} THEN 0
                    WHEN ${sql.ref(column)} LIKE ${`${escapeLike(text)}%`} THEN 1 ELSE 2 END)`;

export function suggestPeople(db: Database, text: string, limit: number) {
  const starts = `${escapeLike(text)}%`;
  const word = `% ${escapeLike(text)}%`;
  return db
    .selectFrom('users')
    .select(['users.id', 'users.name', 'users.avatarUrl'])
    .where((eb) => discoverableUser(eb))
    .where((eb) => eb.or([eb('users.name', 'like', starts), eb('users.name', 'like', word)]))
    .orderBy(rank('users.name', text))
    .orderBy('users.createdAt', 'desc')
    .orderBy('users.id', 'desc')
    .limit(limit)
    .execute();
}

export function suggestProjects(db: Database, text: string, limit: number) {
  const starts = `${escapeLike(text)}%`;
  const word = `% ${escapeLike(text)}%`;
  return db
    .selectFrom('projects')
    .innerJoin('users as owner', 'owner.id', 'projects.userId')
    .select(['projects.id', 'projects.title'])
    .where((eb) => discoverableProject(eb))
    .where((eb) => discoverableOwner(eb as never))
    .where((eb) =>
      eb.or([eb('projects.title', 'like', starts), eb('projects.title', 'like', word)]),
    )
    .orderBy(rank('projects.title', text))
    .orderBy('projects.createdAt', 'desc')
    .orderBy('projects.id', 'desc')
    .limit(limit)
    .execute();
}

/**
 * Registered terms that something **public** uses: a term used only by private
 * or draft work, or by a private profile, is not suggested, so the box cannot be
 * used to probe for it. The registry's `name` is the primary key, so the prefix
 * is a range scan.
 */
export function suggestTags(db: Database, text: string, limit: number) {
  const starts = `${escapeLike(text)}%`;
  const word = `% ${escapeLike(text)}%`;
  return db
    .selectFrom('terms')
    .select('terms.name')
    .where((eb) => eb.or([eb('terms.name', 'like', starts), eb('terms.name', 'like', word)]))
    .where((eb) =>
      eb.or([
        ...(['projectTechnologies', 'projectTags'] as const).map((table) =>
          eb.exists(
            eb
              .selectFrom(table)
              .innerJoin('projects', 'projects.id', `${table}.projectId`)
              .innerJoin('users as owner', 'owner.id', 'projects.userId')
              .select(`${table}.projectId`)
              .whereRef(`${table}.name`, '=', 'terms.name')
              .where((q) => discoverableProject(q))
              .where((q) => discoverableOwner(q as never)),
          ),
        ),
        eb.exists(
          eb
            .selectFrom('userSkills')
            .innerJoin('users', 'users.id', 'userSkills.userId')
            .select('userSkills.id')
            .whereRef('userSkills.skillName', '=', 'terms.name')
            .where((q) => discoverableUser(q)),
        ),
      ]),
    )
    .orderBy(rank('terms.name', text))
    .orderBy(sql`CHAR_LENGTH(terms.name)`)
    .orderBy('terms.name')
    .limit(limit)
    .execute();
}
