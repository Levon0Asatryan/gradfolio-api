import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { AppError, ConflictError } from '../../../core/errors/app-error.js';
import {
  LinkedinZipError,
  type LinkedinZipErrorCode,
} from '../../../core/linkedin-export/errors.js';
import { readLinkedinZip } from '../../../core/linkedin-export/zip-reader.js';
import { IMPORT_ZIP_TYPE, importKey, importPrefix } from '../../../core/storage/file-rules.js';
import { FILE_STORAGE, type FileStorage } from '../../../core/storage/file-storage.js';
import { certificationSection } from '../../profiles/repositories/certification.repository.js';
import { educationSection } from '../../profiles/repositories/education.repository.js';
import { experienceSection } from '../../profiles/repositories/experience.repository.js';
import { listSkills } from '../../profiles/repositories/skill.repository.js';
import type { UserRow } from '../../users/repositories/user.repository.js';
import type {
  linkedinPreviewRequestSchema,
  linkedinUploadRequestSchema,
} from '../dto/linkedin-import.dto.js';
import { buildPreview, type ExistingProfile } from '../utils/linkedin-preview.js';
import type { z } from 'zod';

/** Message and status of each refusal. Messages are static: they never quote the archive. */
const REFUSALS: Record<LinkedinZipErrorCode, { message: string; status: number }> = {
  IMPORT_NOT_ZIP: { message: 'the upload is not a ZIP archive', status: 422 },
  IMPORT_TOO_MANY_ENTRIES: { message: 'the archive holds too many entries', status: 422 },
  IMPORT_UNCOMPRESSED_TOO_LARGE: { message: 'the archive is too large once unpacked', status: 422 },
  IMPORT_RATIO_EXCEEDED: { message: 'an entry is compressed suspiciously well', status: 422 },
  IMPORT_UNSAFE_PATH: { message: 'the archive holds an entry with an unsafe name', status: 422 },
  IMPORT_ENCRYPTED: { message: 'the archive holds an encrypted entry', status: 422 },
  IMPORT_ENTRY_NOT_CSV: { message: 'a data file in the archive is not a CSV', status: 422 },
  IMPORT_DUPLICATE_ENTRY: { message: 'the archive holds a data file twice', status: 422 },
  IMPORT_EMPTY: { message: 'the archive holds none of the files Gradfolio reads', status: 422 },
  IMPORT_COLUMNS_MISSING: { message: 'a data file lacks columns it needs', status: 422 },
  IMPORT_LANGUAGE_UNRECOGNISED: {
    message: 'the export language is not recognised; download the English export',
    status: 422,
  },
  IMPORT_MALFORMED_CSV: { message: 'a data file could not be read', status: 422 },
};

const BUSY_RETRY_AFTER_S = '5';

@Injectable()
export class LinkedinImportService {
  /** Previews running in this process (one API process, Q9). */
  private running = 0;
  /**
   * Tickets signed and not yet seen as an object, per user: upload id -> expiry (ms). A
   * ticket creates nothing in the bucket until the browser PUTs, so the listing alone would
   * let a client collect tickets past IMPORT_MAX_PENDING. One API process (Q9).
   */
  private readonly tickets = new Map<string, Map<string, number>>();

  constructor(
    @Inject(FILE_STORAGE) private readonly storage: FileStorage | null,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly dbs: DbService,
    @InjectPinoLogger(LinkedinImportService.name) private readonly logger: PinoLogger,
  ) {}

  private requireStorage(): FileStorage {
    if (this.storage === null || this.cfg.STORAGE_BUCKET === undefined) {
      throw new AppError('STORAGE_UNAVAILABLE', 'file uploads are not available', 503);
    }
    return this.storage;
  }

  /**
   * A signed `PUT` for the export ZIP, under `imports/<userId>/<uploadId>.zip`. Create-only
   * and pinned to the exact size, like every upload (M4). At most IMPORT_MAX_PENDING
   * objects may wait under the caller's prefix.
   */
  async createUpload(user: UserRow, body: z.output<typeof linkedinUploadRequestSchema>) {
    const storage = this.requireStorage();
    if (body.size > this.cfg.IMPORT_MAX_ZIP_BYTES) {
      throw new AppError('IMPORT_TOO_LARGE', 'the export is too large', 413);
    }
    const cap = this.cfg.IMPORT_MAX_PENDING;
    const listed = await storage.list(importPrefix(user.id), cap);
    // No await between the count and the reservation: concurrent requests see each other.
    const owed = this.outstanding(user.id, new Set(listed.map((o) => o.key)));
    if (listed.length + owed >= cap) {
      throw new ConflictError('LIMIT_REACHED', `at most ${cap} uploads may wait for a preview`);
    }
    const uploadId = randomUUID();
    const ttlMs = this.cfg.UPLOAD_URL_TTL_S * 1000;
    const mine = this.tickets.get(user.id) ?? new Map<string, number>();
    mine.set(uploadId, Date.now() + ttlMs);
    this.tickets.set(user.id, mine);
    const signed = await storage
      .signUpload({
        key: importKey(user.id, uploadId),
        contentType: IMPORT_ZIP_TYPE,
        size: body.size,
        ttlS: this.cfg.UPLOAD_URL_TTL_S,
      })
      .catch((err: unknown) => {
        mine.delete(uploadId);
        throw err;
      });
    return {
      uploadId,
      uploadUrl: signed.url,
      method: 'PUT' as const,
      headers: signed.headers,
      expiresAt: new Date(Date.now() + this.cfg.UPLOAD_URL_TTL_S * 1000).toISOString(),
    };
  }

  /**
   * Reads the uploaded export and proposes entries. Nothing is saved, and the object is
   * deleted afterwards whatever the outcome (a failed delete is logged; the bucket's
   * lifecycle rule is the backstop). The key is derived from the caller and the id, so
   * another user's id finds no object.
   */
  async preview(user: UserRow, body: z.output<typeof linkedinPreviewRequestSchema>) {
    const storage = this.requireStorage();
    const key = importKey(user.id, body.uploadId);
    this.tickets.get(user.id)?.delete(body.uploadId);

    const info = await storage.stat(key);
    if (info === null) throw new AppError('IMPORT_UPLOAD_MISSING', 'no such upload', 404);

    // Busy is checked after the existence check and before any read; the upload is kept so
    // the student can ask again.
    if (this.running >= this.cfg.IMPORT_MAX_CONCURRENT) {
      const busy = new AppError('IMPORT_BUSY', 'too many previews are running; retry shortly', 429);
      busy.headers = { 'Retry-After': BUSY_RETRY_AFTER_S };
      throw busy;
    }
    this.running += 1;
    try {
      if (info.size > this.cfg.IMPORT_MAX_ZIP_BYTES) {
        throw new AppError('IMPORT_TOO_LARGE', 'the export is too large', 413);
      }
      const read = await readLinkedinZip(
        { size: info.size, open: (start, end) => storage.openRange(key, start, end) },
        {
          maxEntries: this.cfg.IMPORT_MAX_ENTRIES,
          maxUncompressedBytes: this.cfg.IMPORT_MAX_UNCOMPRESSED_BYTES,
          maxEntryBytes: this.cfg.IMPORT_MAX_ENTRY_BYTES,
          maxRatio: this.cfg.IMPORT_MAX_RATIO,
          maxRows: this.cfg.IMPORT_MAX_ROWS,
        },
      );
      const preview = buildPreview(read, await this.existing(user.id));
      return {
        ...preview,
        skippedColumns: read.skippedColumns,
        missingFiles: read.missingFiles,
        skippedFileCount: read.skippedFileCount,
        extensions: read.extensions,
      };
    } catch (err) {
      if (err instanceof LinkedinZipError) {
        const refusal = REFUSALS[err.code];
        this.logger.info({ code: err.code }, 'linkedin import refused');
        throw new AppError(err.code, refusal.message, refusal.status, err.details);
      }
      throw err;
    } finally {
      this.running -= 1;
      await this.discard(storage, key);
    }
  }

  /** Unexpired tickets of this user whose object is not in the listing yet. */
  private outstanding(userId: string, present: Set<string>): number {
    const mine = this.tickets.get(userId);
    if (mine === undefined) return 0;
    const now = Date.now();
    let n = 0;
    for (const [id, expires] of mine) {
      if (expires <= now || present.has(importKey(userId, id))) mine.delete(id);
      else n += 1;
    }
    if (mine.size === 0) this.tickets.delete(userId);
    return n;
  }

  private async discard(storage: FileStorage, key: string): Promise<void> {
    try {
      await storage.delete(key);
    } catch {
      // The preview's outcome stands; the lifecycle rule removes it within a day.
      this.logger.error({ prefix: 'imports/' }, 'linkedin import upload delete failed');
    }
  }

  private async existing(userId: string): Promise<ExistingProfile> {
    const { db } = this.dbs;
    const [experience, education, certifications, skills] = await Promise.all([
      experienceSection.list(db, userId),
      educationSection.list(db, userId),
      certificationSection.list(db, userId),
      listSkills(db, userId),
    ]);
    return { experience, education, certifications, skills };
  }
}
