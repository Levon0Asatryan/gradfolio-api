/**
 * What the API needs from object storage, and nothing GCS-shaped beyond it.
 * `GcsFileStorage` is the production implementation; tests use an in-memory one
 * with the same preconditions (src/testing/fake-storage.ts).
 */
export interface ObjectInfo {
  size: number;
  contentType: string;
  /** Opaque; the version of the *bytes*. A re-upload creates a new one. */
  generation: string;
  /** Opaque; the version of the metadata within a generation. Restarts at 1 for each generation. */
  metageneration: string;
  claimed: boolean;
}

export interface ListedObject {
  key: string;
  updatedAt: Date;
  generation: string;
  metageneration: string;
}

export interface SignedUpload {
  url: string;
  /**
   * The headers the PUT must carry, exactly: they are part of the signature. They
   * include a create-only precondition (`x-goog-if-generation-match: 0`), so the
   * URL can write its key once and a replay is refused.
   */
  headers: Record<string, string>;
}

export interface FileStorage {
  signUpload(args: {
    key: string;
    contentType: string;
    size: number;
    ttlS: number;
  }): Promise<SignedUpload>;
  signRead(key: string, ttlS: number): Promise<string>;
  /** `null`: no such object. */
  stat(key: string): Promise<ObjectInfo | null>;
  /** The first `bytes` bytes of the object. */
  readHead(key: string, bytes: number): Promise<Buffer>;
  /**
   * Marks the object registered, only if it is still exactly the version that
   * was validated (same bytes, same metadata). `false`: someone changed it first
   * (a competing registration won, or the bytes were replaced).
   */
  claim(
    key: string,
    version: { generation: string; metageneration: string },
    label: string,
  ): Promise<boolean>;
  /**
   * Missing is not an error. With `version`, deletes only that version: `false`
   * means the object changed since (it became live, or was replaced) and was kept.
   */
  delete(key: string, version?: { generation: string; metageneration: string }): Promise<boolean>;
  /** Up to `max` objects under `prefix`. `updatedAt` is the last write of bytes *or* metadata. */
  list(prefix: string, max: number): Promise<ListedObject[]>;
}

/** Nest token for the storage in use. */
export const FILE_STORAGE = Symbol('FILE_STORAGE');
