import type { Insertable, Transaction, Updateable } from 'kysely';
import { toJsonColumn } from '../../../core/db/json.js';
import type { DB, Projects } from '../../../core/db/types.generated.js';
import { linkList } from '../../../core/validation/json-shapes.js';
import type { ProjectInput } from '../dto/project-write.dto.js';

/** Every JSON list is validated again on its way to the column (`toJsonColumn`). */
const LIST_CEILING = 1000;

/** The columns a project write sets, from the validated input. `descriptionHtml` is the branded, sanitized one. */
function toColumns(input: ProjectInput): Updateable<Projects> {
  return {
    title: input.title,
    summary: input.summary,
    descriptionHtml: input.descriptionHtml,
    category: input.category,
    status: input.status,
    isPublic: input.isPublic,
    isDraft: input.isDraft,
    liveDemoUrl: input.liveDemoUrl,
    repoUrl: input.repoUrl,
    heroImageUrl: input.heroImageUrl,
    metaStartDate: input.metadata.startDate,
    metaEndDate: input.metadata.endDate,
    metaCourse: input.metadata.course,
    metaProfessor: input.metadata.professor,
    links: toJsonColumn(linkList({ maxItems: LIST_CEILING }), input.links),
    files: toJsonColumn(linkList({ maxItems: LIST_CEILING }), input.files),
  };
}

export async function countOwnedProjects(trx: Transaction<DB>, userId: string): Promise<number> {
  const row = await trx
    .selectFrom('projects')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('userId', '=', userId)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

export async function insertProject(
  trx: Transaction<DB>,
  userId: string,
  id: string,
  input: ProjectInput,
): Promise<void> {
  await trx
    .insertInto('projects')
    .values({ id, userId, ...toColumns(input) } as Insertable<Projects>)
    .execute();
}

/**
 * The caller's project, locked (`FOR UPDATE`) until the transaction ends, in
 * the shape the write schemas take. Someone else's id, a deleted one and an
 * unknown one are all "none".
 */
export async function lockOwnedProject(
  trx: Transaction<DB>,
  userId: string,
  id: string,
): Promise<
  (Omit<ProjectInput, 'descriptionHtml'> & { descriptionHtml: string | null }) | undefined
> {
  const row = await trx
    .selectFrom('projects')
    .select([
      'title',
      'summary',
      'descriptionHtml',
      'category',
      'status',
      'isPublic',
      'isDraft',
      'liveDemoUrl',
      'repoUrl',
      'heroImageUrl',
      'metaStartDate',
      'metaEndDate',
      'metaCourse',
      'metaProfessor',
      'links',
      'files',
    ])
    .where('id', '=', id)
    .where('userId', '=', userId)
    .forUpdate()
    .executeTakeFirst();
  if (row === undefined) return undefined;
  const [tags, technologies] = await Promise.all([
    trx
      .selectFrom('projectTags')
      .select('name')
      .where('projectId', '=', id)
      .orderBy('sortOrder')
      .orderBy('name')
      .execute(),
    trx
      .selectFrom('projectTechnologies')
      .select('name')
      .where('projectId', '=', id)
      .orderBy('sortOrder')
      .orderBy('name')
      .execute(),
  ]);
  return {
    title: row.title,
    summary: row.summary,
    descriptionHtml: row.descriptionHtml,
    category: row.category,
    status: row.status,
    isPublic: row.isPublic,
    isDraft: row.isDraft,
    liveDemoUrl: row.liveDemoUrl,
    repoUrl: row.repoUrl,
    heroImageUrl: row.heroImageUrl,
    metadata: {
      startDate: row.metaStartDate,
      endDate: row.metaEndDate,
      course: row.metaCourse,
      professor: row.metaProfessor,
    },
    technologies: technologies.map((t) => t.name),
    tags: tags.map((t) => t.name),
    links: row.links ?? [],
    files: row.files ?? [],
  };
}

/** Rows matched: 0 means no such project of the caller's. */
export async function updateOwnedProject(
  trx: Transaction<DB>,
  userId: string,
  id: string,
  input: ProjectInput,
): Promise<number> {
  const result = await trx
    .updateTable('projects')
    .set(toColumns(input))
    .where('id', '=', id)
    .where('userId', '=', userId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/**
 * Locks the caller's project row (`FOR UPDATE`) without reading it: the mutex
 * for everything that depends on the project's *set* of children (attachment
 * add, reorder, delete). `false`: not the caller's, deleted, or unknown.
 */
export async function lockProjectRow(
  trx: Transaction<DB>,
  userId: string,
  id: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom('projects')
    .select('id')
    .where('id', '=', id)
    .where('userId', '=', userId)
    .forUpdate()
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * The file URLs a project holds -- hero and every attachment's url and
 * thumbnail -- read with the project row locked, so what is deleted is exactly
 * what the delete took with it, and the title the project had (for the activity
 * about its deletion). `undefined`: not the caller's.
 */
export async function lockProjectFileUrls(
  trx: Transaction<DB>,
  userId: string,
  id: string,
): Promise<{ title: string; urls: (string | null)[] } | undefined> {
  const project = await trx
    .selectFrom('projects')
    .select(['title', 'heroImageUrl'])
    .where('id', '=', id)
    .where('userId', '=', userId)
    .forUpdate()
    .executeTakeFirst();
  if (project === undefined) return undefined;
  const attachments = await trx
    .selectFrom('projectAttachments')
    .select(['url', 'thumbnailUrl'])
    .where('projectId', '=', id)
    .execute();
  return {
    title: project.title,
    urls: [project.heroImageUrl, ...attachments.flatMap((a) => [a.url, a.thumbnailUrl])],
  };
}

/** Rows deleted inside a transaction: 0 means no such project of the caller's. */
export async function deleteOwnedProjectIn(
  trx: Transaction<DB>,
  userId: string,
  id: string,
): Promise<number> {
  const result = await trx
    .deleteFrom('projects')
    .where('id', '=', id)
    .where('userId', '=', userId)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
