import type { FileStorage, ObjectInfo, SignedUpload } from '../core/storage/file-storage.js';

interface FakeObject {
  body: Buffer;
  contentType: string;
  metageneration: number;
  claimed: string | undefined;
  updatedAt: Date;
}

/**
 * In-memory storage with GCS's observable rules: a claim is a metadata write
 * that succeeds only at the metageneration it read, so exactly one of two
 * competing registrations wins (proved against the real bucket, plan §3.3).
 */
export class FakeFileStorage implements FileStorage {
  readonly objects = new Map<string, FakeObject>();
  readonly deleted: string[] = [];
  readonly signedReads: string[] = [];
  /** Keys whose delete should fail, to test that a failed delete is logged and not fatal. */
  readonly failDelete = new Set<string>();

  constructor(readonly bucket = 'test-bucket') {}

  /** What the browser would have PUT. */
  put(key: string, body: Buffer, contentType: string, updatedAt = new Date()): void {
    this.objects.set(key, { body, contentType, metageneration: 1, claimed: undefined, updatedAt });
  }

  signUpload({ key, contentType, size, ttlS }: Parameters<FileStorage['signUpload']>[0]) {
    const url = `https://${this.bucket}.storage.googleapis.com/${key}?X-Goog-Expires=${ttlS}&X-Goog-Signature=fake`;
    const headers = {
      'Content-Type': contentType,
      'x-goog-content-length-range': `${size},${size}`,
    };
    return Promise.resolve<SignedUpload>({ url, headers });
  }

  signRead(key: string, ttlS: number) {
    this.signedReads.push(key);
    return Promise.resolve(
      `https://${this.bucket}.storage.googleapis.com/${key}?X-Goog-Expires=${ttlS}&X-Goog-Signature=read-${this.signedReads.length}`,
    );
  }

  /** Test seam: runs after a `stat` has read, before it returns, to force two registrations to overlap. */
  afterStat: (() => Promise<void>) | undefined;

  async stat(key: string): Promise<ObjectInfo | null> {
    const o = this.objects.get(key);
    const info = await this.read(o);
    await this.afterStat?.();
    return info;
  }

  private read(o: FakeObject | undefined): Promise<ObjectInfo | null> {
    return Promise.resolve(
      o === undefined
        ? null
        : {
            size: o.body.length,
            contentType: o.contentType,
            metageneration: String(o.metageneration),
            claimed: o.claimed !== undefined,
          },
    );
  }

  readHead(key: string, bytes: number) {
    return Promise.resolve(this.objects.get(key)?.body.subarray(0, bytes) ?? Buffer.alloc(0));
  }

  async claim(key: string, metageneration: string, label: string) {
    // Yield once so two concurrent claims interleave the way two requests do.
    await Promise.resolve();
    const o = this.objects.get(key);
    if (o === undefined || String(o.metageneration) !== metageneration) return false;
    o.metageneration++;
    o.claimed = label;
    return true;
  }

  delete(key: string) {
    if (this.failDelete.has(key)) return Promise.reject(new Error('delete failed (injected)'));
    this.objects.delete(key);
    this.deleted.push(key);
    return Promise.resolve();
  }

  list(prefix: string, max: number) {
    return Promise.resolve(
      [...this.objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .slice(0, max)
        .map(([key, o]) => ({ key, updatedAt: o.updatedAt })),
    );
  }
}
