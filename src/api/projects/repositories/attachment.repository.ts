import type { Transaction } from 'kysely';
import type { DB } from '../../../core/db/types.generated.js';

export interface AttachmentRow {
  id: string;
  type: 'image' | 'video' | 'pdf' | 'link';
  url: string;
  title: string | null;
  thumbnailUrl: string | null;
}

const COLUMNS = ['id', 'type', 'url', 'title', 'thumbnailUrl'] as const;

export function listAttachmentRows(trx: Pick<Transaction<DB>, 'selectFrom'>, projectId: string) {
  return trx
    .selectFrom('projectAttachments')
    .select(COLUMNS)
    .where('projectId', '=', projectId)
    .orderBy('sortOrder')
    .orderBy('id')
    .execute();
}

/** One attachment, only if it belongs to `projectId` (the caller's project, locked by the caller). */
export function findAttachment(trx: Transaction<DB>, projectId: string, id: string) {
  return trx
    .selectFrom('projectAttachments')
    .select(COLUMNS)
    .where('id', '=', id)
    .where('projectId', '=', projectId)
    .forUpdate()
    .executeTakeFirst();
}

/** One past the largest sort_order, or 0: a new attachment goes last. */
export async function nextSortOrder(trx: Transaction<DB>, projectId: string): Promise<number> {
  const row = await trx
    .selectFrom('projectAttachments')
    .select((eb) => eb.fn.max<number | null>('sortOrder').as('highest'))
    .where('projectId', '=', projectId)
    .executeTakeFirstOrThrow();
  return row.highest === null ? 0 : Number(row.highest) + 1;
}

export async function insertAttachment(
  trx: Transaction<DB>,
  projectId: string,
  id: string,
  sortOrder: number,
  a: Omit<AttachmentRow, 'id'>,
): Promise<void> {
  await trx
    .insertInto('projectAttachments')
    .values({ id, projectId, sortOrder, ...a })
    .execute();
}

/** Rows matched: 0 means the attachment is not this project's. */
export async function updateAttachment(
  trx: Transaction<DB>,
  projectId: string,
  id: string,
  a: Omit<AttachmentRow, 'id' | 'type'>,
): Promise<number> {
  const result = await trx
    .updateTable('projectAttachments')
    .set(a)
    .where('id', '=', id)
    .where('projectId', '=', projectId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

export async function deleteAttachment(
  trx: Transaction<DB>,
  projectId: string,
  id: string,
): Promise<number> {
  const result = await trx
    .deleteFrom('projectAttachments')
    .where('id', '=', id)
    .where('projectId', '=', projectId)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
