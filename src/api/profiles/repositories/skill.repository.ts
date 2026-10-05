import type { Database } from '../../../core/db/database.js';

/** The caller's skills in the order they chose, scoped by `user_id`. */
export async function listSkills(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('userSkills')
    .select('skillName')
    .where('userId', '=', userId)
    .orderBy('sortOrder')
    .orderBy('skillName')
    .execute();
  return rows.map((r) => r.skillName);
}
