import type { Database } from '../../../core/db/database.js';

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
