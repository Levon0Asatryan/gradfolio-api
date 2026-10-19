import type { Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { DB } from '../../../core/db/types.generated.js';
import type { ProjectNow } from '../services/project-rules.js';

/**
 * Reads for repository-change suggestions (docs/modules/m7/plan.md §6.6e). Every
 * statement is scoped to the caller's `user_id`.
 */

type Executor = Database | Transaction<DB>;

export interface ImportedProject {
  projectId: string;
  repoId: number;
  syncedAt: Date;
}

/** The caller's projects imported from these repositories, with when their snapshot was written. */
export async function importedProjects(
  db: Executor,
  userId: string,
  repoIds: readonly number[],
): Promise<ImportedProject[]> {
  if (repoIds.length === 0) return [];
  const rows = await db
    .selectFrom('projects')
    .innerJoin('projectGithubImports', 'projectGithubImports.projectId', 'projects.id')
    .select(['projects.id as projectId', 'projects.githubRepoId', 'projectGithubImports.syncedAt'])
    .where('projects.userId', '=', userId)
    .where('projects.githubRepoId', 'in', [...repoIds])
    .execute();
  return rows.flatMap((r) =>
    r.githubRepoId === null
      ? []
      : [{ projectId: r.projectId, repoId: Number(r.githubRepoId), syncedAt: r.syncedAt }],
  );
}

/**
 * The caller's projects as they are now, **locked** until the transaction ends: a
 * re-sync, an edit or a delete in flight is waited for, so what is decided from
 * these rows is what is stored. Ordered by id, so two such locks never cross.
 */
export async function lockProjectStates(
  trx: Transaction<DB>,
  userId: string,
  projectIds: readonly string[],
): Promise<Map<string, ProjectNow>> {
  if (projectIds.length === 0) return new Map();
  const ids = [...projectIds].sort();
  const projects = await trx
    .selectFrom('projects')
    .select(['id', 'title', 'summary', 'descriptionHtml'])
    .where('userId', '=', userId)
    .where('id', 'in', ids)
    .orderBy('id')
    .forUpdate()
    .execute();
  const snapshots = await trx
    .selectFrom('projectGithubImports')
    .select(['projectId', 'snapshot'])
    .where(
      'projectId',
      'in',
      projects.map((p) => p.id),
    )
    .orderBy('projectId')
    .forUpdate()
    .execute();
  const byProject = new Map(snapshots.map((s) => [s.projectId, s.snapshot]));
  return new Map(
    projects.map((p) => [
      p.id,
      {
        projectId: p.id,
        title: p.title,
        summary: p.summary,
        descriptionHtml: p.descriptionHtml,
        snapshot: byProject.get(p.id) ?? {},
      },
    ]),
  );
}
