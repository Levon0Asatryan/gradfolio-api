import { sql } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { TimeCursor } from '../../common/utils/time-cursor.js';
import { visibleTo } from '../../profiles/utils/visibility.js';
import { projectReadableBy } from '../../projects/utils/visibility.js';

/**
 * Every statement here is scoped to `userId`, the notification's owner: a
 * notification is reachable only through its own `user_id` (S3), so someone
 * else's id is "no row", exactly like an unknown one.
 */

/** One page, newest first, starting after `cursor`; `limit + 1` rows so the caller sees whether more exist. */
export function listNotificationRows(
  db: Database,
  userId: string,
  cursor: TimeCursor | undefined,
  limit: number,
) {
  return db
    .selectFrom('notifications')
    .select([
      'id',
      'type',
      'title',
      'params',
      'isRead',
      'referenceId',
      'referenceType',
      'createdAt',
    ])
    .where('userId', '=', userId)
    .$if(cursor !== undefined, (qb) => {
      const c = cursor!;
      return qb.where(
        sql<boolean>`(${sql.ref('notifications.createdAt')}, ${sql.ref('notifications.id')}) < (${new Date(c.t)}, ${c.id})`,
      );
    })
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)
    .execute();
}

export type NotificationRow = Awaited<ReturnType<typeof listNotificationRows>>[number];

export async function countUnread(db: Database, userId: string): Promise<number> {
  const row = await db
    .selectFrom('notifications')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('userId', '=', userId)
    .where('isRead', '=', false)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Rows matched: 0 means no such notification of the caller's. Marking a read one again matches 1. */
export async function markRead(db: Database, userId: string, id: string): Promise<number> {
  const result = await db
    .updateTable('notifications')
    .set({ isRead: true })
    .where('id', '=', id)
    .where('userId', '=', userId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

export async function markAllRead(db: Database, userId: string): Promise<number> {
  const result = await db
    .updateTable('notifications')
    .set({ isRead: true })
    .where('userId', '=', userId)
    .where('isRead', '=', false)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Of `ids`, the projects `viewerId` may open (a deleted project is simply absent). */
export async function readableProjectIds(
  db: Database,
  viewerId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectFrom('projects')
    .select('projects.id')
    .where('projects.id', 'in', ids)
    .where((eb) => projectReadableBy(eb, viewerId))
    .execute();
  return new Set(rows.map((r) => r.id));
}

/** The reader's own membership status per project. */
export async function membershipStatuses(
  db: Database,
  userId: string,
  projectIds: string[],
): Promise<Map<string, 'pending' | 'accepted' | 'rejected'>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('projectTeamMembers')
    .select(['projectId', 'status'])
    .where('userId', '=', userId)
    .where('projectId', 'in', projectIds)
    .execute();
  return new Map(rows.map((r) => [r.projectId, r.status]));
}

/** Of `ids`, the users whose profile `viewerId` may open (Q3). */
export async function visibleUserIds(
  db: Database,
  viewerId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectFrom('users')
    .select('users.id')
    .where('users.id', 'in', ids)
    .where((eb) => visibleTo(eb, viewerId))
    .execute();
  return new Set(rows.map((r) => r.id));
}
