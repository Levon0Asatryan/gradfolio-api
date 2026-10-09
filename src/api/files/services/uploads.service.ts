import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../core/errors/app-error.js';
import {
  canonicalObjectUrl,
  isImageType,
  newObjectKey,
  PDF_TYPE,
  userPrefix,
} from '../../../core/storage/file-rules.js';
import { FILE_STORAGE, type FileStorage } from '../../../core/storage/file-storage.js';
import { uploadRequestSchema, type UploadResponse } from '../dto/upload.dto.js';

@Injectable()
export class UploadsService {
  constructor(
    @Inject(FILE_STORAGE) private readonly storage: FileStorage | null,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly dbs: DbService,
  ) {}

  /**
   * A signed `PUT` for one file. Nothing is reserved: the cap counts the
   * objects already under the user's prefix, so the true bound is the cap plus
   * the URLs signed but not yet used (rate limit × URL lifetime; plan §3.5).
   *
   * `projectId` is optional for `hero` and `attachment`, so a file can be uploaded
   * while the project is still being created. The key carries no project, so
   * nothing here binds the file to one: registration does that (the one row that
   * claims it). When given, the project must be the caller's (404 otherwise).
   */
  async sign(userId: string, body: unknown): Promise<UploadResponse> {
    const { storage } = this;
    const bucket = this.cfg.STORAGE_BUCKET;
    if (storage === null || bucket === undefined) {
      throw new AppError('STORAGE_UNAVAILABLE', 'file uploads are not available', 503);
    }
    const parsed = uploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      );
    }
    const req = parsed.data;

    const problems: { path: string; message: string }[] = [];
    if (req.purpose !== 'attachment' && !isImageType(req.contentType)) {
      problems.push({ path: 'contentType', message: `a ${req.purpose} must be an image` });
    }
    const max =
      req.contentType === PDF_TYPE
        ? this.cfg.UPLOAD_MAX_PDF_BYTES
        : this.cfg.UPLOAD_MAX_IMAGE_BYTES;
    if (req.size > max) problems.push({ path: 'size', message: `must be at most ${max} bytes` });
    if (req.purpose === 'avatar' && req.projectId !== undefined) {
      problems.push({ path: 'projectId', message: 'an avatar belongs to no project' });
    }
    if (problems.length > 0) throw new ValidationError(problems);

    if (req.projectId !== undefined) {
      const owned = await this.dbs.db
        .selectFrom('projects')
        .select('id')
        .where('id', '=', req.projectId)
        .where('userId', '=', userId)
        .executeTakeFirst();
      if (owned === undefined) throw new NotFoundError('project');
    }

    const cap = this.cfg.UPLOAD_MAX_FILES_PER_USER;
    if ((await storage.list(userPrefix(userId), cap)).length >= cap) {
      throw new ConflictError('LIMIT_REACHED', `at most ${cap} files are allowed`);
    }

    const key = newObjectKey(userId, req.contentType);
    const signed = await storage.signUpload({
      key,
      contentType: req.contentType,
      size: req.size,
      ttlS: this.cfg.UPLOAD_URL_TTL_S,
    });
    return {
      uploadUrl: signed.url,
      method: 'PUT',
      headers: signed.headers,
      fileUrl: canonicalObjectUrl(bucket, key),
      expiresAt: new Date(Date.now() + this.cfg.UPLOAD_URL_TTL_S * 1000).toISOString(),
    };
  }
}
