import type { FileStorage, ObjectInfo, SignedUpload } from '../core/storage/file-storage.js';

interface FakeObject {
  body: Buffer;
  contentType: string;
  generation: number;
  metageneration: number;
  claimed: string | undefined;
  updatedAt: Date;
}

/**
 * In-memory storage with GCS's observable rules, each proved against the real
 * bucket (plan §3.3, PR (c) follow-up): a claim is a metadata write that
 * succeeds only at the exact generation and metageneration it validated, so
 * exactly one of two competing registrations wins and replaced bytes cannot be
 * claimed; a claim refreshes `updated`; a PUT signed with
 * `x-goog-if-generation-match: 0` writes a key once and a replay is a 412; a
 * delete with a version is refused when the object changed since.
 */
export class FakeFileStorage implements FileStorage {
  readonly objects = new Map<string, FakeObject>();
  readonly deleted: string[] = [];
  readonly signedReads: string[] = [];
  /** Keys whose delete should fail, to test that a failed delete is logged and not fatal. */
  readonly failDelete = new Set<string>();

  constructor(readonly bucket = 'test-bucket') {}

  private generations = 0;

  /** Writes an object directly (a new generation), as a PUT that passed its preconditions would. */
  put(key: string, body: Buffer, contentType: string, updatedAt = new Date()): void {
    this.objects.set(key, {
      body,
      contentType,
      generation: ++this.generations,
      metageneration: 1,
      claimed: undefined,
      updatedAt,
    });
  }

  /**
   * What the browser's PUT does with a ticket: the signed headers are enforced
   * the way the bucket enforces them. Returns the HTTP status.
   */
  putSigned(ticket: { uploadUrl: string; headers: Record<string, string> }, body: Buffer): number {
    const key = decodeURIComponent(new URL(ticket.uploadUrl).pathname.slice(1));
    const range = ticket.headers['x-goog-content-length-range'];
    const [min, max] = (range ?? '0,Infinity').split(',').map(Number);
    if (body.length < (min ?? 0) || body.length > (max ?? Infinity)) return 400;
    if (ticket.headers['x-goog-if-generation-match'] === '0' && this.objects.has(key)) return 412;
    this.put(key, body, ticket.headers['Content-Type'] ?? 'application/octet-stream');
    return 200;
  }

  signUpload({ key, contentType, size, ttlS }: Parameters<FileStorage['signUpload']>[0]) {
    const url = `https://${this.bucket}.storage.googleapis.com/${key}?X-Goog-Expires=${ttlS}&X-Goog-Signature=fake`;
    const headers = {
      'Content-Type': contentType,
      'x-goog-content-length-range': `${size},${size}`,
      'x-goog-if-generation-match': '0',
    };
    return Promise.resolve<SignedUpload>({ url, headers });
  }

  /** Test seam: signing a read URL fails (IAM or storage down). */
  failSignRead = false;

  signRead(key: string, ttlS: number) {
    if (this.failSignRead) return Promise.reject(new Error('signing failed (injected)'));
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
            generation: String(o.generation),
            metageneration: String(o.metageneration),
            claimed: o.claimed !== undefined,
          },
    );
  }

  readHead(key: string, bytes: number) {
    return Promise.resolve(this.objects.get(key)?.body.subarray(0, bytes) ?? Buffer.alloc(0));
  }

  async claim(key: string, version: { generation: string; metageneration: string }, label: string) {
    // Yield once so two concurrent claims interleave the way two requests do.
    await Promise.resolve();
    const o = this.objects.get(key);
    if (o === undefined || !this.matches(o, version)) return false;
    o.metageneration++;
    o.claimed = label;
    o.updatedAt = new Date();
    return true;
  }

  private matches(o: FakeObject, v: { generation: string; metageneration: string }) {
    return String(o.generation) === v.generation && String(o.metageneration) === v.metageneration;
  }

  delete(key: string, version?: { generation: string; metageneration: string }) {
    if (this.failDelete.has(key)) return Promise.reject(new Error('delete failed (injected)'));
    const o = this.objects.get(key);
    if (o !== undefined && version !== undefined && !this.matches(o, version)) {
      return Promise.resolve(false);
    }
    this.objects.delete(key);
    this.deleted.push(key);
    return Promise.resolve(true);
  }

  /** Test seam: runs once, after `list` has read and before it returns. */
  afterList: (() => Promise<void>) | undefined;

  async list(prefix: string, max: number) {
    const listed = [...this.objects.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .slice(0, max)
      .map(([key, o]) => ({
        key,
        updatedAt: o.updatedAt,
        generation: String(o.generation),
        metageneration: String(o.metageneration),
      }));
    const hook = this.afterList;
    this.afterList = undefined;
    await hook?.();
    return listed;
  }
}
