import { sql } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { BrowseProjectsQuery, BrowseUsersQuery } from '../dto/discovery.dto.js';
import { discoverableOwner, discoverableProject, discoverableUser } from '../utils/discoverable.js';
import type { DiscoveryCursor } from '../utils/discovery-cursor.js';
import { CARD_COLUMNS } from './search.repository.js';

/**
 * Browse (docs/m6-plan.md §3.5). Every statement starts from the discoverable
 * predicates and orders on an index added in 0007, ending in `id` in the same
 * direction so `(time, id)` is a total order and a row-value comparison pages
 * without a repeat or a gap.
 */

const SORT_COLUMN = { newest: 'createdAt', updated: 'updatedAt' } as const;

/** The statement behind `browseProjects`, unexecuted, so a test can EXPLAIN exactly what runs. */
export function browseProjectsQuery(
  db: Database,
  q: Pick<BrowseProjectsQuery, 'sort' | 'category' | 'status'>,
  cursor: DiscoveryCursor | undefined,
  limit: number,
) {
  const column = SORT_COLUMN[q.sort];
  const raw = column === 'createdAt' ? 'projects.created_at' : 'projects.updated_at';
  return db
    .selectFrom('projects')
    .innerJoin('users as owner', 'owner.id', 'projects.userId')
    .select(CARD_COLUMNS)
    .select(['owner.id as ownerId', 'owner.name as ownerName', 'owner.avatarUrl as ownerAvatarUrl'])
    .where((eb) => discoverableProject(eb))
    .where((eb) => discoverableOwner(eb as never))
    .$if(q.category !== undefined, (qb) => qb.where('projects.category', '=', q.category!))
    .$if(q.status !== undefined, (qb) => qb.where('projects.status', '=', q.status!))
    .$if(cursor !== undefined, (qb) =>
      qb.where(
        sql<boolean>`(${sql.raw(raw)}, projects.id) < (${new Date(cursor!.t)}, ${cursor!.id})`,
      ),
    )
    .orderBy(`projects.${column}`, 'desc')
    .orderBy('projects.id', 'desc')
    .limit(limit + 1);
}

/** At most `limit + 1` discoverable projects in `sort` order after `cursor`. */
export const browseProjects = (...args: Parameters<typeof browseProjectsQuery>) =>
  browseProjectsQuery(...args).execute();

/** The statement behind `browseUsers`, unexecuted. */
export function browseUsersQuery(
  db: Database,
  q: Pick<BrowseUsersQuery, 'school' | 'major' | 'gradYear'>,
  cursor: DiscoveryCursor | undefined,
  limit: number,
) {
  const filtered = q.school !== undefined || q.major !== undefined || q.gradYear !== undefined;
  return db
    .selectFrom('users')
    .select([
      'users.id',
      'users.name',
      'users.headline',
      'users.avatarUrl',
      'users.verified',
      'users.location',
      'users.createdAt',
    ])
    .where((eb) => discoverableUser(eb))
    .$if(filtered, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom('education as e')
            .select('e.id')
            .whereRef('e.userId', '=', 'users.id')
            .$if(q.school !== undefined, (b) => b.where('e.institution', '=', q.school!))
            .$if(q.major !== undefined, (b) => b.where('e.field', '=', q.major!))
            .$if(q.gradYear !== undefined, (b) => b.where('e.endYear', '=', q.gradYear!)),
        ),
      ),
    )
    .$if(cursor !== undefined, (qb) =>
      qb.where(
        sql<boolean>`(users.created_at, users.id) < (${new Date(cursor!.t)}, ${cursor!.id})`,
      ),
    )
    .orderBy('users.createdAt', 'desc')
    .orderBy('users.id', 'desc')
    .limit(limit + 1);
}

/** At most `limit + 1` public users, newest first, who have an education entry matching every filter given. */
export const browseUsers = (...args: Parameters<typeof browseUsersQuery>) =>
  browseUsersQuery(...args).execute();

/**
 * The values present on public profiles' education, most common first. `count`
 * is people (distinct users), not entries. Grouping is under the column's
 * collation, so `NPUA` and `npua` are one choice; one spelling is returned.
 */
export async function userFacets(db: Database, max: number) {
  const base = () =>
    db
      .selectFrom('users')
      .innerJoin('education as e', 'e.userId', 'users.id')
      .where((eb) => discoverableUser(eb));
  const [schools, majors, years] = await Promise.all([
    base()
      .select([
        (eb) => eb.fn.min('e.institution').as('value'),
        (eb) => eb.fn.count<number>('e.userId').distinct().as('count'),
      ])
      .groupBy('e.institution')
      .orderBy('count', 'desc')
      .orderBy('value')
      .limit(max)
      .execute(),
    base()
      .select([
        (eb) => eb.fn.min('e.field').as('value'),
        (eb) => eb.fn.count<number>('e.userId').distinct().as('count'),
      ])
      .groupBy('e.field')
      .orderBy('count', 'desc')
      .orderBy('value')
      .limit(max)
      .execute(),
    base()
      .select([
        'e.endYear as value',
        (eb) => eb.fn.count<number>('e.userId').distinct().as('count'),
      ])
      .where('e.endYear', 'is not', null)
      .groupBy('e.endYear')
      .orderBy('count', 'desc')
      .orderBy('value', 'desc')
      .limit(max)
      .execute(),
  ]);
  return {
    schools: schools.map((r) => ({ value: String(r.value), count: Number(r.count) })),
    majors: majors.map((r) => ({ value: String(r.value), count: Number(r.count) })),
    years: years.map((r) => ({ value: Number(r.value), count: Number(r.count) })),
  };
}

/**
 * Tag cloud: for every term, discoverable projects (a term that is both a tag
 * and a technology of one project counts once) and public people who list it.
 * Most used first, then by name. One statement over three indexed tables.
 */
export async function tagCloud(db: Database, max: number) {
  const { rows } = await sql<{ name: string; projects: string; people: string }>`
    SELECT t.name, SUM(t.projects) AS projects, SUM(t.people) AS people FROM (
      SELECT pt.name AS name, COUNT(DISTINCT pt.project_id) AS projects, 0 AS people
        FROM (SELECT project_id, name FROM project_technologies
              UNION SELECT project_id, name FROM project_tags) pt
        JOIN projects p ON p.id = pt.project_id AND p.is_public = 1 AND p.is_draft = 0
        JOIN users o ON o.id = p.user_id AND o.is_public = 1
       GROUP BY pt.name
      UNION ALL
      SELECT s.skill_name, 0, COUNT(*)
        FROM user_skills s JOIN users u ON u.id = s.user_id AND u.is_public = 1
       GROUP BY s.skill_name
    ) t
    GROUP BY t.name
    ORDER BY SUM(t.projects) + SUM(t.people) DESC, t.name
    LIMIT ${max}`.execute(db);
  return rows.map((r) => ({
    name: r.name,
    projects: Number(r.projects),
    people: Number(r.people),
  }));
}
