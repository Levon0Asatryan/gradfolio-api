import { type ExpressionBuilder, sql } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { DB } from '../../../core/db/types.generated.js';
import type { ProjectListQuery } from '../dto/project.dto.js';
import { type Cursor, type ProjectSort, SORTS } from '../utils/cursor.js';
import { isPublished, projectVisibleTo } from '../utils/visibility.js';

/**
 * Columns a project read may select, listed one by one and never `selectAll()`:
 * a column added to `projects` later must be opted in here before it can reach
 * a response (OWASP API3). `githubRepoId` is deliberately absent.
 */
const SUMMARY_COLUMNS = [
  'projects.id',
  'projects.userId',
  'projects.title',
  'projects.summary',
  'projects.category',
  'projects.status',
  'projects.heroImageUrl',
  'projects.isPublic',
  'projects.isDraft',
  'projects.metaStartDate',
  'projects.metaEndDate',
  'projects.metaCourse',
  'projects.metaProfessor',
  'projects.createdAt',
  'projects.updatedAt',
] as const;

const DETAIL_COLUMNS = [
  ...SUMMARY_COLUMNS,
  'projects.aiSummary',
  'projects.descriptionHtml',
  'projects.liveDemoUrl',
  'projects.links',
  'projects.files',
  'projects.source',
  'projects.repoUrl',
  'projects.repoLatestCommit',
  'projects.repoReadmeUrl',
  'projects.repoStars',
  'projects.repoForks',
  'projects.repoLanguage',
] as const;

/** One project if `viewerId` may read it (see `projectVisibleTo`), with its owner's public facts. */
export function findVisibleProject(db: Database, id: string, viewerId: string | undefined) {
  return db
    .selectFrom('projects')
    .innerJoin('users as owner', 'owner.id', 'projects.userId')
    .select(DETAIL_COLUMNS)
    .select([
      'owner.name as ownerName',
      'owner.avatarUrl as ownerAvatarUrl',
      'owner.isPublic as ownerIsPublic',
    ])
    .where('projects.id', '=', id)
    .where((eb) => projectVisibleTo(eb, viewerId))
    .executeTakeFirst();
}

export type ProjectDetailRow = NonNullable<Awaited<ReturnType<typeof findVisibleProject>>>;

export function listAttachments(db: Database, projectId: string) {
  return db
    .selectFrom('projectAttachments')
    .select(['id', 'type', 'url', 'title', 'thumbnailUrl'])
    .where('projectId', '=', projectId)
    .orderBy('sortOrder')
    .orderBy('id')
    .execute();
}

/**
 * Accepted team members of a project the caller can already read. `memberVisible`
 * says whether the member's own profile is readable by the caller (Q3), which
 * decides whether the response may link to it.
 */
export async function listAcceptedTeam(
  db: Database,
  projectId: string,
  viewerId: string | undefined,
) {
  const rows = await db
    .selectFrom('projectTeamMembers as m')
    .leftJoin('users as u', 'u.id', 'm.userId')
    .select(['m.id', 'm.name', 'm.role', 'm.avatarUrl', 'm.userId', 'u.isPublic as memberIsPublic'])
    .where('m.projectId', '=', projectId)
    .where('m.status', '=', 'accepted')
    .orderBy('m.sortOrder')
    .orderBy('m.createdAt')
    .orderBy('m.id')
    .execute();
  return rows.map(({ memberIsPublic, ...m }) => ({
    ...m,
    memberVisible: m.userId !== null && (memberIsPublic === true || m.userId === viewerId),
  }));
}

export interface ListScope {
  ownerId: string;
  /** Public, published projects only (a user's page), else every state (the caller's own). */
  publishedOnly: boolean;
}

/** `%`, `_` and `\` in a user's search text are text, not wildcards. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

function filters(eb: ExpressionBuilder<DB, 'projects'>, scope: ListScope, q: ProjectListQuery) {
  const conditions = [eb('projects.userId', '=', scope.ownerId)];
  if (scope.publishedOnly) conditions.push(isPublished(eb));
  if (q.state === 'published') conditions.push(isPublished(eb));
  if (q.state === 'draft') conditions.push(eb('projects.isDraft', '=', true));
  if (q.state === 'private') {
    conditions.push(eb('projects.isDraft', '=', false), eb('projects.isPublic', '=', false));
  }
  if (q.category !== undefined) conditions.push(eb('projects.category', '=', q.category));
  if (q.status !== undefined) conditions.push(eb('projects.status', '=', q.status));
  // Names match through the table's case-insensitive collation.
  if (q.tag !== undefined) {
    const tag = q.tag;
    conditions.push(
      eb.exists(
        eb
          .selectFrom('projectTags as t')
          .select('t.projectId')
          .whereRef('t.projectId', '=', 'projects.id')
          .where('t.name', '=', tag),
      ),
    );
  }
  if (q.technology !== undefined) {
    const technology = q.technology;
    conditions.push(
      eb.exists(
        eb
          .selectFrom('projectTechnologies as x')
          .select('x.projectId')
          .whereRef('x.projectId', '=', 'projects.id')
          .where('x.name', '=', technology),
      ),
    );
  }
  if (q.q !== undefined) {
    const pattern = `%${escapeLike(q.q)}%`;
    conditions.push(
      eb.or([
        eb('projects.title', 'like', pattern),
        eb.exists(
          eb
            .selectFrom('projectTechnologies as x')
            .select('x.projectId')
            .whereRef('x.projectId', '=', 'projects.id')
            .where('x.name', 'like', pattern),
        ),
      ]),
    );
  }
  return eb.and(conditions);
}

/**
 * One page, in `sort` order, starting after `cursor`. Reads `limit + 1` rows so
 * the caller can tell whether another page exists. The order always ends in
 * `id` in the same direction, so `(sort value, id)` is a total order and the
 * row-value comparison below neither repeats nor skips a row.
 */
export function listProjectRows(
  db: Database,
  scope: ListScope,
  q: ProjectListQuery,
  sort: ProjectSort,
  cursor: Cursor | undefined,
  limit: number,
) {
  const spec = SORTS[sort];
  const column = sql.ref(`projects.${spec.column}`);
  return db
    .selectFrom('projects')
    .select(SUMMARY_COLUMNS)
    .where((eb) => filters(eb, scope, q))
    .$if(cursor !== undefined, (qb) => {
      const c = cursor!;
      const value = spec.kind === 'date' ? new Date(Number(c.v)) : String(c.v);
      const op = spec.direction === 'asc' ? sql`>` : sql`<`;
      return qb.where(sql<boolean>`(${column}, projects.id) ${op} (${value}, ${c.id})`);
    })
    .orderBy(`projects.${spec.column}`, spec.direction)
    .orderBy('projects.id', spec.direction)
    .limit(limit + 1)
    .execute();
}

export type ProjectSummaryRow = Awaited<ReturnType<typeof listProjectRows>>[number];
