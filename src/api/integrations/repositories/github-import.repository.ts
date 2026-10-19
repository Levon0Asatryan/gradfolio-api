import type { Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import { toJsonColumn } from '../../../core/db/json.js';
import type { DB } from '../../../core/db/types.generated.js';
import { githubImportSnapshot } from '../../../core/validation/json-shapes.js';

/**
 * Reads and writes of GitHub-imported projects (docs/modules/m7/plan.md §3.3, §3.5).
 * Every statement is scoped to the caller's `user_id` (or goes through a
 * project the caller owns).
 */

type Executor = Database | Transaction<DB>;

/** The caller's projects imported from the given repositories: repository id → project id. */
export async function importedProjectIds(
  db: Executor,
  userId: string,
  repoIds: readonly number[],
): Promise<Map<number, string>> {
  if (repoIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('projects')
    .select(['id', 'githubRepoId'])
    .where('userId', '=', userId)
    .where('githubRepoId', 'in', [...repoIds])
    .execute();
  return new Map(
    rows.flatMap((r) => (r.githubRepoId === null ? [] : [[Number(r.githubRepoId), r.id] as const])),
  );
}

export interface GithubProjectMeta {
  source: 'manual' | 'github';
  githubRepoId: number | null;
  repoStars: number | null;
  repoForks: number | null;
  repoLanguage: string | null;
  repoReadmeUrl: string | null;
}

/** The caller's project's GitHub columns; undefined when it is not theirs. */
export async function githubProjectMeta(
  db: Executor,
  userId: string,
  projectId: string,
): Promise<GithubProjectMeta | undefined> {
  const row = await db
    .selectFrom('projects')
    .select(['source', 'githubRepoId', 'repoStars', 'repoForks', 'repoLanguage', 'repoReadmeUrl'])
    .where('id', '=', projectId)
    .where('userId', '=', userId)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  return {
    source: row.source,
    githubRepoId: row.githubRepoId === null ? null : Number(row.githubRepoId),
    repoStars: row.repoStars,
    repoForks: row.repoForks,
    repoLanguage: row.repoLanguage,
    repoReadmeUrl: row.repoReadmeUrl,
  };
}

/** The snapshot of the last import or re-sync; undefined when none was written. */
export async function readSnapshot(
  trx: Transaction<DB>,
  projectId: string,
): Promise<Record<string, string> | undefined> {
  const row = await trx
    .selectFrom('projectGithubImports')
    .select('snapshot')
    .where('projectId', '=', projectId)
    .forUpdate()
    .executeTakeFirst();
  return row?.snapshot ?? undefined;
}

/** Creates or replaces a project's snapshot. Call inside the project's transaction. */
export async function writeSnapshot(
  trx: Transaction<DB>,
  projectId: string,
  snapshot: Record<string, string>,
): Promise<void> {
  const value = toJsonColumn(githubImportSnapshot, snapshot);
  await trx
    .insertInto('projectGithubImports')
    .values({ projectId, snapshot: value, syncedAt: new Date() })
    .onDuplicateKeyUpdate({ snapshot: value, syncedAt: new Date() })
    .execute();
}
