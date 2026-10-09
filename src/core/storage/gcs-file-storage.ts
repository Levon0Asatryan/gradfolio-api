import { Storage } from '@google-cloud/storage';
import type { FileStorage, ObjectInfo, SignedUpload } from './file-storage.js';

const NOT_FOUND = 404;
const PRECONDITION_FAILED = 412;

const codeOf = (err: unknown): number | undefined =>
  typeof err === 'object' && err !== null && 'code' in err ? Number(err.code) : undefined;

/**
 * Google Cloud Storage with Application Default Credentials. On Cloud Run that
 * is the service account, and signing goes through IAM `signBlob` (it needs
 * roles/iam.serviceAccountTokenCreator on itself); no key file exists.
 */
export class GcsFileStorage implements FileStorage {
  private readonly bucket;

  constructor(bucketName: string, storage: Storage = new Storage()) {
    this.bucket = storage.bucket(bucketName);
  }

  async signUpload({
    key,
    contentType,
    size,
    ttlS,
  }: Parameters<FileStorage['signUpload']>[0]): Promise<SignedUpload> {
    // Content-Type and an exact size are signed headers: a PUT that changes
    // either does not match the signature (run, docs/m4-plan.md §3.3).
    const range = `${size},${size}`;
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + ttlS * 1000,
      contentType,
      extensionHeaders: { 'x-goog-content-length-range': range },
    });
    return { url, headers: { 'Content-Type': contentType, 'x-goog-content-length-range': range } };
  }

  async signRead(key: string, ttlS: number): Promise<string> {
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlS * 1000,
    });
    return url;
  }

  async stat(key: string): Promise<ObjectInfo | null> {
    try {
      const [meta] = await this.bucket.file(key).getMetadata();
      return {
        size: Number(meta.size),
        contentType: meta.contentType ?? '',
        metageneration: String(meta.metageneration),
        claimed: meta.metadata?.claimed !== undefined,
      };
    } catch (err) {
      if (codeOf(err) === NOT_FOUND) return null;
      throw err;
    }
  }

  async readHead(key: string, bytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.bucket
      .file(key)
      .createReadStream({ start: 0, end: bytes - 1 })) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async claim(key: string, metageneration: string, label: string): Promise<boolean> {
    try {
      await this.bucket
        .file(key)
        .setMetadata(
          { metadata: { claimed: label } },
          { ifMetagenerationMatch: Number(metageneration) },
        );
      return true;
    } catch (err) {
      if (codeOf(err) === PRECONDITION_FAILED) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }

  async list(prefix: string, max: number): Promise<{ key: string; updatedAt: Date }[]> {
    // autoPaginate follows the 1000-per-page limit up to `max` objects in all.
    const [files] = await this.bucket.getFiles({ prefix, maxResults: max, autoPaginate: true });
    return files.map((f) => ({ key: f.name, updatedAt: new Date(String(f.metadata.updated)) }));
  }
}
