import type { Database } from '../../../core/db/database.js';

/**
 * Tags or technologies of several projects in one query, each list in its
 * stored order. Reads only: writing goes through `setProjectTerms`.
 */
export async function termsOf(
  db: Database,
  table: 'projectTags' | 'projectTechnologies',
  projectIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byProject = new Map<string, string[]>();
  if (projectIds.length === 0) return byProject;
  const rows = await db
    .selectFrom(table)
    .select(['projectId', 'name'])
    .where('projectId', 'in', projectIds as string[])
    .orderBy('sortOrder')
    .orderBy('name')
    .execute();
  for (const { projectId, name } of rows) {
    const list = byProject.get(projectId) ?? [];
    list.push(name);
    byProject.set(projectId, list);
  }
  return byProject;
}
