import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { AppError } from '../../../core/errors/app-error.js';
import { FILE_STORAGE, type FileStorage } from '../../../core/storage/file-storage.js';
import {
  canonicalObjectUrl,
  isImageType,
  isUploadType,
  MAGIC_BYTES,
  matchesMagic,
  objectKeyOf,
  PDF_TYPE,
  userPrefix,
} from '../../../core/storage/file-rules.js';

/** What a registered file is for: decides which types and sizes it may have. */
export type FileKind = 'avatar' | 'hero' | 'image' | 'pdf';

/** A file the caller named cannot be registered. A body problem, so 400, not 404. */
export class FileRejectedError extends AppError {
  constructor(code: 'INVALID_FILE' | 'FILE_IN_USE', message: string) {
    super(code, message, 400);
  }
}

interface CachedRead {
  url: string;
  validUntil: number;
}
const READ_CACHE_MAX = 2000;
/** A cached read URL is replaced before it can expire under the browser. */
const READ_CACHE_FRACTION = 0.8;

/**
 * Everything about files that the rest of the API needs to know: whether a URL
 * is ours, registering an uploaded object, turning a stored URL into a signed
 * read URL, and deleting objects whose rows are gone. With no `STORAGE_BUCKET`
 * every URL is external and nothing here touches the network.
 */
@Injectable()
export class FileUrlService {
  private readonly cache = new Map<string, CachedRead>();

  constructor(
    @Inject(FILE_STORAGE) private readonly storage: FileStorage | null,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectPinoLogger(FileUrlService.name) private readonly logger: PinoLogger,
  ) {}

  get enabled(): boolean {
    return this.storage !== null && this.cfg.STORAGE_BUCKET !== undefined;
  }

  /** The object key if `url` is in our bucket, else `null`. */
  keyOf(url: string | null | undefined): string | null {
    if (!url || !this.enabled || this.cfg.STORAGE_BUCKET === undefined) return null;
    return objectKeyOf(url, this.cfg.STORAGE_BUCKET);
  }

  /** The keys among `urls` that are ours. */
  keysOf(urls: readonly (string | null | undefined)[]): string[] {
    return [...new Set(urls.map((u) => this.keyOf(u)).filter((k): k is string => k !== null))];
  }

  /**
   * Registers the file `url` names, for `userId`, and returns the form to
   * store. An external URL is returned as it came (URL-only stays valid).
   * For ours: the key must be under the caller's prefix, the object must exist,
   * hold a type and size allowed for `kind`, start with that type's magic
   * number, and not be registered already. The last step *claims* it with a
   * precondition on its metageneration, so of two concurrent registrations
   * exactly one wins and a key is registered at most once, ever (plan §3.5;
   * run against the real bucket). Once claimed and released, nothing can
   * register it again, so deleting it after commit cannot race a re-use.
   */
  async accept(userId: string, url: string, kind: FileKind): Promise<string> {
    const key = this.keyOf(url);
    if (key === null) return url;
    const { storage } = this;
    const bucket = this.cfg.STORAGE_BUCKET;
    if (storage === null || bucket === undefined) return url;

    if (!key.startsWith(userPrefix(userId))) {
      throw new FileRejectedError('INVALID_FILE', 'that file was not uploaded by you');
    }
    const info = await storage.stat(key);
    if (info === null) throw new FileRejectedError('INVALID_FILE', 'no such uploaded file');
    if (info.claimed) throw new FileRejectedError('FILE_IN_USE', 'that file is already in use');

    const allowed = kind === 'pdf' ? info.contentType === PDF_TYPE : isImageType(info.contentType);
    if (!allowed || !isUploadType(info.contentType)) {
      throw new FileRejectedError('INVALID_FILE', `a ${kind} must not be ${info.contentType}`);
    }
    const max =
      info.contentType === PDF_TYPE
        ? this.cfg.UPLOAD_MAX_PDF_BYTES
        : this.cfg.UPLOAD_MAX_IMAGE_BYTES;
    if (info.size > max || info.size === 0) {
      throw new FileRejectedError('INVALID_FILE', `the file must be between 1 and ${max} bytes`);
    }
    const head = await storage.readHead(key, MAGIC_BYTES);
    if (!matchesMagic(info.contentType, head)) {
      throw new FileRejectedError('INVALID_FILE', `the file is not really ${info.contentType}`);
    }
    if (!(await storage.claim(key, info, kind))) {
      throw new FileRejectedError('FILE_IN_USE', 'that file is already in use');
    }
    return canonicalObjectUrl(bucket, key);
  }

  /**
   * The URL to hand to a client for a stored one: a signed `GET` for ours
   * (valid FILE_READ_URL_TTL_S), cached so a repeated read gets the same URL
   * and costs no IAM call; anything else unchanged. If signing fails the stored
   * URL is returned and the failure logged: a read never fails a request, and a
   * write that committed is never reported as failed because of it.
   */
  async read<T extends string | null | undefined>(url: T): Promise<T> {
    const key = this.keyOf(url);
    if (key === null || this.storage === null) return url;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit !== undefined && hit.validUntil > now) return hit.url as T;
    let signed: string;
    try {
      signed = await this.storage.signRead(key, this.cfg.FILE_READ_URL_TTL_S);
    } catch (err) {
      // A write that already committed must not fail because the *response* could
      // not be signed (IAM or storage down): answer with the stored URL, which a
      // private bucket refuses, and log it. The next read signs again.
      this.logger.error(
        { key, err: err instanceof Error ? err.name : 'unknown' },
        'signing a read URL failed',
      );
      return url;
    }
    this.remember(key, signed, now);
    return signed as T;
  }

  private remember(key: string, url: string, now: number): void {
    if (this.cache.size >= READ_CACHE_MAX) {
      for (const [k, v] of this.cache) if (v.validUntil <= now) this.cache.delete(k);
      if (this.cache.size >= READ_CACHE_MAX) this.cache.clear();
    }
    this.cache.set(key, {
      url,
      validUntil: now + this.cfg.FILE_READ_URL_TTL_S * 1000 * READ_CACHE_FRACTION,
    });
  }

  /**
   * Deletes objects whose rows are gone. Call it **after** the transaction
   * committed. A failure is logged with the key and never reaches the caller:
   * the row change succeeded, and `storage:sweep` removes what is left.
   */
  async release(keys: readonly string[]): Promise<void> {
    const { storage } = this;
    if (storage === null) return;
    for (const key of new Set(keys)) {
      this.cache.delete(key);
      try {
        await storage.delete(key);
      } catch (err) {
        this.logger.error(
          { key, err: err instanceof Error ? err.name : 'unknown' },
          'storage object delete failed',
        );
      }
    }
  }

  /**
   * Deletes every object under a user's prefix -- registered or not -- for
   * account deletion. After the commit, like `release`: a failure to even list
   * is logged and never reaches the caller (the account is already gone).
   */
  async releaseAllOf(userId: string, max: number): Promise<void> {
    if (this.storage === null) return;
    let keys: string[];
    try {
      keys = (await this.storage.list(userPrefix(userId), max)).map((o) => o.key);
    } catch (err) {
      this.logger.error(
        { userId, err: err instanceof Error ? err.name : 'unknown' },
        'storage listing after account deletion failed',
      );
      return;
    }
    await this.release(keys);
  }
}
