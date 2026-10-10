import type { Database } from '../../../core/db/database.js';

/**
 * The caller's own numbers. Every statement is scoped to `userId` in its WHERE
 * clause (an owner scope, not a visibility one: the dashboard is the caller's
 * view of their own account), and none selects a column that is not named.
 */

/** Counts by state and the stored star total, in one pass over the caller's projects. */
export function projectStatsQuery(db: Database, userId: string) {
  return db
    .selectFrom('projects')
    .select((eb) => [
      eb.fn.countAll<number>().as('total'),
      eb.fn
        .sum<number>(
          eb
            .case()
            .when(eb.and([eb('isDraft', '=', false), eb('isPublic', '=', true)]))
            .then(1)
            .else(0)
            .end(),
        )
        .as('published'),
      eb.fn
        .sum<number>(
          eb
            .case()
            .when(eb.and([eb('isDraft', '=', false), eb('isPublic', '=', false)]))
            .then(1)
            .else(0)
            .end(),
        )
        .as('private'),
      eb.fn.sum<number>(eb.case().when('isDraft', '=', true).then(1).else(0).end()).as('draft'),
      // NULL when no non-draft project has stored stars: "unknown", not 0.
      eb.fn
        .sum<number | null>(eb.case().when('isDraft', '=', false).then(eb.ref('repoStars')).end())
        .as('githubStars'),
    ])
    .where('userId', '=', userId);
}

export async function projectStats(db: Database, userId: string) {
  const r = await projectStatsQuery(db, userId).executeTakeFirstOrThrow();
  return {
    total: Number(r.total),
    published: Number(r.published ?? 0),
    private: Number(r.private ?? 0),
    draft: Number(r.draft ?? 0),
    githubStars: r.githubStars === null ? null : Number(r.githubStars),
  };
}

/** The caller's activities at or after `since`: a covering range scan of `(user_id, timestamp, id)`. */
export function recentActivityCountQuery(db: Database, userId: string, since: Date) {
  return db
    .selectFrom('activities')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('userId', '=', userId)
    .where('timestamp', '>=', since);
}

export async function recentActivityCount(db: Database, userId: string, since: Date) {
  const r = await recentActivityCountQuery(db, userId, since).executeTakeFirstOrThrow();
  return Number(r.n);
}
