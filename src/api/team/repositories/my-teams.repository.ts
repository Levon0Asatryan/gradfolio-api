import { sql } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { TimeCursor } from '../../common/utils/time-cursor.js';

/**
 * The four lists of `GET /me/teams`, one statement each, plus one statement
 * that loads the members of a whole page of projects (never one per project).
 * Every list is scoped to `userId` in its own WHERE.
 */

const before = (timeColumn: string, idColumn: string, c: TimeCursor | undefined) =>
  c === undefined
    ? sql<boolean>`1 = 1`
    : sql<boolean>`(${sql.ref(timeColumn)}, ${sql.ref(idColumn)}) < (${new Date(c.t)}, ${c.id})`;

/** Projects the caller owns that have any team row. `limit + 1` rows, newest first. */
export function listOwnedTeamProjects(
  db: Database,
  userId: string,
  cursor: TimeCursor | undefined,
  limit: number,
) {
  return db
    .selectFrom('projects')
    .select([
      'projects.id',
      'projects.title',
      'projects.isPublic',
      'projects.isDraft',
      'projects.createdAt',
    ])
    .where('projects.userId', '=', userId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('projectTeamMembers as t')
          .select('t.id')
          .whereRef('t.projectId', '=', 'projects.id'),
      ),
    )
    .where(before('projects.createdAt', 'projects.id', cursor))
    .orderBy('projects.createdAt', 'desc')
    .orderBy('projects.id', 'desc')
    .limit(limit + 1)
    .execute();
}

/** Team rows of many projects in one statement, with each linked member's account. */
export function listTeamRowsOf(db: Database, projectIds: string[], acceptedOnly: boolean) {
  return db
    .selectFrom('projectTeamMembers as m')
    .leftJoin('users as u', 'u.id', 'm.userId')
    .select([
      'm.id',
      'm.projectId',
      'm.userId',
      'm.name',
      'm.role',
      'm.avatarUrl',
      'm.status',
      'm.createdAt',
      'u.name as liveName',
      'u.avatarUrl as liveAvatarUrl',
      'u.isPublic as memberIsPublic',
    ])
    .where('m.projectId', 'in', projectIds)
    .$if(acceptedOnly, (qb) => qb.where('m.status', '=', 'accepted'))
    .orderBy('m.sortOrder')
    .orderBy('m.createdAt')
    .orderBy('m.id')
    .execute();
}

/** Projects the caller is an accepted member of (never a draft), by when they joined. */
export function listMemberships(
  db: Database,
  userId: string,
  cursor: TimeCursor | undefined,
  limit: number,
) {
  return db
    .selectFrom('projectTeamMembers as m')
    .innerJoin('projects as p', 'p.id', 'm.projectId')
    .innerJoin('users as o', 'o.id', 'p.userId')
    .select([
      'm.id as memberId',
      'm.role',
      'm.createdAt',
      'p.id as projectId',
      'p.title',
      'p.isPublic',
      'o.id as ownerId',
      'o.name as ownerName',
      'o.avatarUrl as ownerAvatarUrl',
      'o.isPublic as ownerIsPublic',
    ])
    .where('m.userId', '=', userId)
    .where('m.status', '=', 'accepted')
    .where('p.isDraft', '=', false)
    .where(before('m.createdAt', 'm.id', cursor))
    .orderBy('m.createdAt', 'desc')
    .orderBy('m.id', 'desc')
    .limit(limit + 1)
    .execute();
}

/** Invitations waiting for the caller: the project's title and the inviter, nothing else of the project. */
export function listIncoming(
  db: Database,
  userId: string,
  cursor: TimeCursor | undefined,
  limit: number,
) {
  return db
    .selectFrom('projectTeamMembers as m')
    .innerJoin('projects as p', 'p.id', 'm.projectId')
    .innerJoin('users as o', 'o.id', 'p.userId')
    .select([
      'm.id as memberId',
      'm.role',
      'm.createdAt',
      'p.id as projectId',
      'p.title',
      'o.id as ownerId',
      'o.name as ownerName',
      'o.isPublic as ownerIsPublic',
    ])
    .where('m.userId', '=', userId)
    .where('m.status', '=', 'pending')
    .where(before('m.createdAt', 'm.id', cursor))
    .orderBy('m.createdAt', 'desc')
    .orderBy('m.id', 'desc')
    .limit(limit + 1)
    .execute();
}

/** Pending invitations on the caller's own projects. */
export function listOutgoing(
  db: Database,
  userId: string,
  cursor: TimeCursor | undefined,
  limit: number,
) {
  return db
    .selectFrom('projectTeamMembers as m')
    .innerJoin('projects as p', 'p.id', 'm.projectId')
    .leftJoin('users as u', 'u.id', 'm.userId')
    .select([
      'm.id as memberId',
      'm.userId',
      'm.name',
      'm.role',
      'm.createdAt',
      'p.id as projectId',
      'p.title',
      'u.name as liveName',
      'u.avatarUrl as liveAvatarUrl',
      'u.isPublic as inviteeIsPublic',
    ])
    .where('p.userId', '=', userId)
    .where('m.status', '=', 'pending')
    .where(before('m.createdAt', 'm.id', cursor))
    .orderBy('m.createdAt', 'desc')
    .orderBy('m.id', 'desc')
    .limit(limit + 1)
    .execute();
}
