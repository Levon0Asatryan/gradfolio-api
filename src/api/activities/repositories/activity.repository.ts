import { sql } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { TimeCursor } from '../../common/utils/time-cursor.js';

/** The caller's feed, newest first; `limit + 1` rows so the caller can tell whether more exist. Always scoped to `userId`. */
export function listActivityRows(
  db: Database,
  userId: string,
  cursor: TimeCursor | undefined,
  limit: number,
) {
  return db
    .selectFrom('activities')
    .select(['id', 'type', 'translationKey', 'translationParams', 'timestamp'])
    .where('userId', '=', userId)
    .$if(cursor !== undefined, (qb) => {
      const c = cursor!;
      return qb.where(
        sql<boolean>`(${sql.ref('activities.timestamp')}, ${sql.ref('activities.id')}) < (${new Date(c.t)}, ${c.id})`,
      );
    })
    .orderBy('timestamp', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)
    .execute();
}
