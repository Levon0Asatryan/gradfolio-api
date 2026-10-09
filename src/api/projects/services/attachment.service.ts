import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { newId } from '../../../core/db/ids.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import {
  applyOrder,
  countOwned,
  lockOwnedIds,
} from '../../profiles/repositories/ordered-section.repository.js';
import { createAttachmentSchema, patchAttachmentSchema } from '../dto/attachment.dto.js';
import type { ProjectAttachment } from '../dto/project.dto.js';
import {
  type AttachmentRow,
  deleteAttachment,
  findAttachment,
  insertAttachment,
  listAttachmentRows,
  nextSortOrder,
  updateAttachment,
} from '../repositories/attachment.repository.js';
import { lockProjectRow } from '../repositories/project-write.repository.js';
import { toAttachment } from '../utils/project-mapping.js';
import { parseVideo } from '../utils/video.js';
import { reorderSchema } from '../../profiles/dto/section.dto.js';
import type { z } from 'zod';

type Resolved = Pick<AttachmentRow, 'url' | 'thumbnailUrl'>;

/**
 * Attachments of the caller's project. Every write first takes the project row
 * (`FOR UPDATE`, scoped to the caller): that is both the ownership check -- a
 * stranger's or unknown project is 404 -- and the mutex for the set of
 * attachments (cap, position, reorder). Lock order: project row, then the
 * attachment rows.
 */
@Injectable()
export class AttachmentService {
  constructor(
    private readonly dbs: DbService,
    private readonly files: FileUrlService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async add(userId: string, projectId: string, body: unknown): Promise<ProjectAttachment> {
    const input = parse(createAttachmentSchema, body);
    const id = newId();
    const resolve = this.resolveOnce(userId, input.type);
    await inTransaction(this.dbs.db, async (trx) => {
      if (!(await lockProjectRow(trx, userId, projectId))) throw new NotFoundError('project');
      if (
        (await countOwned(trx, 'projectAttachments', projectId, 'projectId')) >=
        this.cfg.PROJECT_MAX_ATTACHMENTS
      ) {
        throw new ConflictError(
          'LIMIT_REACHED',
          `at most ${this.cfg.PROJECT_MAX_ATTACHMENTS} attachments are allowed`,
        );
      }
      const stored = await resolve(input.url);
      await insertAttachment(trx, projectId, id, await nextSortOrder(trx, projectId), {
        type: input.type,
        title: input.title,
        ...stored,
      });
    });
    return this.present(await this.get(projectId, id));
  }

  async update(
    userId: string,
    projectId: string,
    id: string,
    body: unknown,
  ): Promise<ProjectAttachment> {
    const patch = parse(patchAttachmentSchema, body);
    let register: ReturnType<AttachmentService['resolveOnce']> | undefined;
    const released = await inTransaction(this.dbs.db, async (trx) => {
      if (!(await lockProjectRow(trx, userId, projectId))) throw new NotFoundError('project');
      const stored = await findAttachment(trx, projectId, id);
      if (stored === undefined) throw new NotFoundError('attachment');
      register ??= this.resolveOnce(userId, stored.type);

      const next: Omit<AttachmentRow, 'id' | 'type'> = {
        title: patch.title !== undefined ? patch.title : stored.title,
        url: stored.url,
        thumbnailUrl: stored.thumbnailUrl,
      };
      if (patch.url !== undefined && !this.sameFile(patch.url, stored.url)) {
        Object.assign(next, await register(patch.url));
      }
      // The pool counts matched rows, so a patch that changes nothing is 1.
      if ((await updateAttachment(trx, projectId, id, next)) === 0) {
        throw new NotFoundError('attachment');
      }
      const kept = this.files.keysOf([next.url, next.thumbnailUrl]);
      return this.files.keysOf([stored.url, stored.thumbnailUrl]).filter((k) => !kept.includes(k));
    });
    await this.files.release(released);
    return this.present(await this.get(projectId, id));
  }

  async remove(userId: string, projectId: string, id: string): Promise<void> {
    const keys = await inTransaction(this.dbs.db, async (trx) => {
      if (!(await lockProjectRow(trx, userId, projectId))) throw new NotFoundError('project');
      const stored = await findAttachment(trx, projectId, id);
      if (stored === undefined) throw new NotFoundError('attachment');
      if ((await deleteAttachment(trx, projectId, id)) === 0) throw new NotFoundError('attachment');
      return this.files.keysOf([stored.url, stored.thumbnailUrl]);
    });
    await this.files.release(keys);
  }

  /**
   * Reorders to exactly `ids`. Under the project lock, with the attachment rows
   * locked, so the set cannot change between the check and the write. An id
   * that is not this project's (foreign, deleted, unknown) is 404, all alike;
   * the right ids but an incomplete list is 409.
   */
  async reorder(userId: string, projectId: string, body: unknown): Promise<ProjectAttachment[]> {
    const { ids } = parse(reorderSchema, body);
    await inTransaction(this.dbs.db, async (trx) => {
      if (!(await lockProjectRow(trx, userId, projectId))) throw new NotFoundError('project');
      const owned = new Set(await lockOwnedIds(trx, 'projectAttachments', projectId, 'projectId'));
      if (ids.some((id) => !owned.has(id))) throw new NotFoundError('attachment');
      if (ids.length !== owned.size) {
        throw new ConflictError('ORDER_STALE', 'the list changed; reload it and try again');
      }
      if (
        (await applyOrder(trx, 'projectAttachments', projectId, ids, 'projectId')) !== ids.length
      ) {
        // Cannot happen under the lock; rolling back beats a half-applied order.
        throw new Error('reorder matched fewer rows than the project holds');
      }
    });
    return Promise.all(
      (await listAttachmentRows(this.dbs.db, projectId)).map((a) => this.present(a)),
    );
  }

  private async get(projectId: string, id: string): Promise<AttachmentRow> {
    const row = (await listAttachmentRows(this.dbs.db, projectId)).find((a) => a.id === id);
    if (row === undefined) throw new NotFoundError('attachment');
    return row;
  }

  private async present(row: AttachmentRow): Promise<ProjectAttachment> {
    const a = toAttachment(row, this.cfg.ATTACHMENT_VIDEO_HOSTS);
    return {
      ...a,
      url: await this.files.read(a.url),
      thumbnailUrl: await this.files.read(a.thumbnailUrl),
    };
  }

  /** The same object, whether named by its stored form or a signed one. */
  private sameFile(requested: string, stored: string): boolean {
    const key = this.files.keyOf(requested);
    return requested === stored || (key !== null && key === this.files.keyOf(stored));
  }

  /**
   * What to store for `url` as an attachment of `type`, remembered per URL for
   * this request: a deadlock retry reruns the transaction body, and a file the
   * first attempt claimed must not be refused as "already in use" by the second.
   */
  private resolveOnce(userId: string, type: AttachmentRow['type']) {
    const done = new Map<string, Promise<Resolved>>();
    return (url: string): Promise<Resolved> => {
      const hit = done.get(url);
      if (hit !== undefined) return hit;
      const pending = this.resolve(userId, type, url);
      done.set(url, pending);
      return pending;
    };
  }

  private async resolve(
    userId: string,
    type: AttachmentRow['type'],
    url: string,
  ): Promise<Resolved> {
    switch (type) {
      case 'image':
        return { url: await this.files.accept(userId, url, 'image'), thumbnailUrl: null };
      case 'pdf':
        return { url: await this.files.accept(userId, url, 'pdf'), thumbnailUrl: null };
      case 'video': {
        const video = parseVideo(url, this.cfg.ATTACHMENT_VIDEO_HOSTS);
        if (video === null) {
          throw new ValidationError([
            { path: 'url', message: 'must be a YouTube or Vimeo video link' },
          ]);
        }
        return { url, thumbnailUrl: video.thumbnailUrl };
      }
      case 'link':
        // A link is never a file of ours: only an uploaded image or PDF is registered,
        // and only registered files are ever handed out signed.
        if (this.files.keyOf(url) !== null) {
          throw new ValidationError([
            {
              path: 'url',
              message: 'a link cannot point at an uploaded file; add it as an image or PDF',
            },
          ]);
        }
        return { url, thumbnailUrl: null };
    }
  }
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
    );
  }
  return parsed.data;
}
