import { type Selectable, sql, type Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { DB, ProjectTeamMembers } from '../../../core/db/types.generated.js';

/**
 * The project's id if `userId` owns it. Scoping by owner in the statement
 * itself (S4): someone else's project, a deleted one and an unknown one are all
 * "none".
 */
export async function findOwnedProjectId(
  db: Database,
  userId: string,
  projectId: string,
): Promise<string | undefined> {
  const row = await db
    .selectFrom('projects')
    .select('id')
    .where('id', '=', projectId)
    .where('userId', '=', userId)
    .executeTakeFirst();
  return row?.id;
}

/**
 * Every team write below runs inside `inTransaction`, in this lock order: the
 * project row, then the member row, then inserts (docs/m5-plan.md §4.3). One
 * order for all of them, so invite, accept, remove and leave cannot deadlock.
 */

export interface LockedProject {
  id: string;
  userId: string;
  title: string;
  isDraft: boolean;
}

/**
 * The caller's own project, locked `FOR UPDATE` until the transaction ends.
 * Ownership is in this very statement (S4): someone else's, a deleted and an
 * unknown project are all "none". The lock also serialises every owner write
 * on the team.
 */
export function lockOwnedProject(
  trx: Transaction<DB>,
  userId: string,
  projectId: string,
): Promise<LockedProject | undefined> {
  return trx
    .selectFrom('projects')
    .select(['id', 'userId', 'title', 'isDraft'])
    .where('id', '=', projectId)
    .where('userId', '=', userId)
    .forUpdate()
    .executeTakeFirst();
}

/** Any project, locked `FOR SHARE`: invitee answers wait for an owner write in flight, never the other way round. */
export function lockProjectShared(
  trx: Transaction<DB>,
  projectId: string,
): Promise<LockedProject | undefined> {
  return trx
    .selectFrom('projects')
    .select(['id', 'userId', 'title', 'isDraft'])
    .where('id', '=', projectId)
    .forShare()
    .executeTakeFirst();
}

/** A user whose profile is public: the only people an owner may invite. */
export function findPublicUser(trx: Transaction<DB>, id: string) {
  return trx
    .selectFrom('users')
    .select(['id', 'name', 'avatarUrl'])
    .where('id', '=', id)
    .where('isPublic', '=', true)
    .executeTakeFirst();
}

export async function countMembers(trx: Transaction<DB>, projectId: string): Promise<number> {
  const row = await trx
    .selectFrom('projectTeamMembers')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('projectId', '=', projectId)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

const MEMBER_COLUMNS = [
  'id',
  'projectId',
  'userId',
  'name',
  'role',
  'avatarUrl',
  'status',
  'createdAt',
] as const;

export type MemberRow = Selectable<ProjectTeamMembers>;

/** One user's row on a project, locked `FOR UPDATE`. */
export function lockMemberOfUser(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('projectTeamMembers')
    .select(MEMBER_COLUMNS)
    .where('projectId', '=', projectId)
    .where('userId', '=', userId)
    .forUpdate()
    .executeTakeFirst();
}

export function readMember(trx: Transaction<DB>, id: string) {
  return trx
    .selectFrom('projectTeamMembers')
    .select(MEMBER_COLUMNS)
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

export async function insertMember(
  trx: Transaction<DB>,
  row: {
    id: string;
    projectId: string;
    userId: string | null;
    name: string;
    role: string | null;
    status: 'pending' | 'accepted';
  },
): Promise<void> {
  await trx.insertInto('projectTeamMembers').values(row).execute();
}

/**
 * Invites a rejected user again: the same row goes back to `pending` (D6: the
 * unique key on (project, user) makes a second INSERT impossible). The WHERE
 * clause is the rule "only from rejected". Rows matched; 0 means it was not.
 */
export async function renewInvite(
  trx: Transaction<DB>,
  projectId: string,
  userId: string,
  fields: { name: string; role: string | null },
): Promise<number> {
  const result = await trx
    .updateTable('projectTeamMembers')
    .set({
      status: 'pending',
      name: fields.name,
      role: fields.role,
      createdAt: sql`CURRENT_TIMESTAMP`,
    })
    .where('projectId', '=', projectId)
    .where('userId', '=', userId)
    .where('status', '=', 'rejected')
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Accept or reject: only from `pending`. Rows matched; 0 means it was not pending. */
export async function answerInvite(
  trx: Transaction<DB>,
  memberId: string,
  fields: { status: 'accepted' | 'rejected'; name: string },
): Promise<number> {
  const result = await trx
    .updateTable('projectTeamMembers')
    .set(fields)
    .where('id', '=', memberId)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Scoped to the project, so another project's member id is "none". Rows deleted. */
export async function deleteMember(
  trx: Transaction<DB>,
  projectId: string,
  memberId: string,
): Promise<number> {
  const result = await trx
    .deleteFrom('projectTeamMembers')
    .where('id', '=', memberId)
    .where('projectId', '=', projectId)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

/** Leaving removes the caller's own accepted row only. Rows deleted. */
export async function deleteOwnAcceptedMember(
  trx: Transaction<DB>,
  memberId: string,
  userId: string,
): Promise<number> {
  const result = await trx
    .deleteFrom('projectTeamMembers')
    .where('id', '=', memberId)
    .where('userId', '=', userId)
    .where('status', '=', 'accepted')
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

/** Public profiles whose name starts with `prefix` (already LIKE-escaped), never the caller. */
export function lookupUsers(db: Database, callerId: string, prefix: string, limit: number) {
  return db
    .selectFrom('users')
    .select(['id', 'name', 'headline', 'avatarUrl'])
    .where('isPublic', '=', true)
    .where('id', '<>', callerId)
    .where('name', 'like', `${prefix}%`)
    .orderBy('name')
    .orderBy('id')
    .limit(limit)
    .execute();
}
