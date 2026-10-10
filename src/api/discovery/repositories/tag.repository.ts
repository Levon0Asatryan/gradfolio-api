import { sql } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import { discoverableOwner, discoverableProject, discoverableUser } from '../utils/discoverable.js';
import type { DiscoveryCursor } from '../utils/discovery-cursor.js';

/**
 * Projects and people for one term (docs/m6-plan.md §3). Names match through
 * the term tables' case-insensitive collation, never `JSON_CONTAINS` (S9).
 */

/** The registry's spelling of `name`, or `undefined` when no one ever used it. */
export async function canonicalTerm(db: Database, name: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('terms')
    .select('name')
    .where('name', '=', name)
    .executeTakeFirst();
  return row?.name;
}

/** Counts of discoverable projects and people that use `name`. Two cheap, indexed aggregates. */
export async function tagCounts(db: Database, name: string) {
  const projectIds = db
    .selectFrom('projectTechnologies')
    .select('projectId')
    .where('name', '=', name)
    .union(db.selectFrom('projectTags').select('projectId').where('name', '=', name));
  const [projects, people] = await Promise.all([
    db
      .selectFrom('projects')
      .innerJoin('users as owner', 'owner.id', 'projects.userId')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where((eb) => discoverableProject(eb))
      .where((eb) => discoverableOwner(eb as never))
      .where('projects.id', 'in', projectIds)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where((eb) => discoverableUser(eb))
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('userSkills as s')
            .select('s.id')
            .whereRef('s.userId', '=', 'users.id')
            .where('s.skillName', '=', name),
        ),
      )
      .executeTakeFirstOrThrow(),
  ]);
  return { projectCount: Number(projects.n), peopleCount: Number(people.n) };
}

const afterTime = (c: DiscoveryCursor | undefined, table: 'projects' | 'users') =>
  c === undefined
    ? undefined
    : sql<boolean>`(${sql.raw(`${table}.created_at`)}, ${sql.raw(`${table}.id`)}) < (${new Date(c.t)}, ${c.id})`;

/** One page of discoverable projects using `name`, newest first (`limit + 1` rows). */
export function projectsWithTerm(
  db: Database,
  name: string,
  cursor: DiscoveryCursor | undefined,
  limit: number,
) {
  const projectIds = db
    .selectFrom('projectTechnologies')
    .select('projectId')
    .where('name', '=', name)
    .union(db.selectFrom('projectTags').select('projectId').where('name', '=', name));
  const cond = afterTime(cursor, 'projects');
  return db
    .selectFrom('projects')
    .innerJoin('users as owner', 'owner.id', 'projects.userId')
    .select([
      'projects.id',
      'projects.title',
      'projects.summary',
      'projects.category',
      'projects.status',
      'projects.heroImageUrl',
      'projects.createdAt',
      'projects.updatedAt',
      'owner.id as ownerId',
      'owner.name as ownerName',
      'owner.avatarUrl as ownerAvatarUrl',
    ])
    .where((eb) => discoverableProject(eb))
    .where((eb) => discoverableOwner(eb as never))
    .where('projects.id', 'in', projectIds)
    .$if(cond !== undefined, (qb) => qb.where(cond!))
    .orderBy('projects.createdAt', 'desc')
    .orderBy('projects.id', 'desc')
    .limit(limit + 1)
    .execute();
}

/** One page of public people who list `name` as a skill, newest first (`limit + 1` rows). */
export function peopleWithTerm(
  db: Database,
  name: string,
  cursor: DiscoveryCursor | undefined,
  limit: number,
) {
  const cond = afterTime(cursor, 'users');
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
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('userSkills as s')
          .select('s.id')
          .whereRef('s.userId', '=', 'users.id')
          .where('s.skillName', '=', name),
      ),
    )
    .$if(cond !== undefined, (qb) => qb.where(cond!))
    .orderBy('users.createdAt', 'desc')
    .orderBy('users.id', 'desc')
    .limit(limit + 1)
    .execute();
}
