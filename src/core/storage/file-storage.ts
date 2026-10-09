/**
 * What the API needs from object storage, and nothing GCS-shaped beyond it.
 * `GcsFileStorage` is the production implementation; tests use an in-memory one
 * with the same preconditions (src/testing/fake-storage.ts).
 */
export interface ObjectInfo {
  size: number;
  contentType: string;
  /** Opaque; passed back to `claim` so only one registration can win. */
  metageneration: string;
  claimed: boolean;
}

export interface SignedUpload {
  url: string;
  /** The headers the PUT must carry, exactly: they are part of the signature. */
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
   * Marks the object registered, only if it is still at `metageneration`.
   * `false`: someone else changed it first (a competing registration won).
   */
  claim(key: string, metageneration: string, label: string): Promise<boolean>;
  /** Missing is not an error. */
  delete(key: string): Promise<void>;
  /** Up to `max` objects under `prefix`. */
  list(prefix: string, max: number): Promise<{ key: string; updatedAt: Date }[]>;
}

/** Nest token for the storage in use. */
export const FILE_STORAGE = Symbol('FILE_STORAGE');
