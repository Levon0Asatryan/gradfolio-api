import { IMPORTS_ROOT } from './file-rules.js';
import type { FileStorage } from './file-storage.js';

export interface ImportSweepResult {
  scanned: number;
  /** Export ZIPs older than the floor. */
  stale: string[];
  deleted: number;
  kept: number;
}

const SWEEP_LIMIT = 100_000;

/**
 * Deletes LinkedIn export ZIPs a preview never picked up (the browser uploaded, then the tab
 * closed). A preview deletes its own object; this and the bucket's lifecycle rule
 * (docker/gcs-lifecycle.json) are the backstops. Only `imports/` is looked at, and only the
 * exact version that was listed is deleted.
 */
export async function sweepImports(
  storage: FileStorage,
  { apply, minAgeMs, now = Date.now() }: { apply: boolean; minAgeMs: number; now?: number },
): Promise<ImportSweepResult> {
  const objects = await storage.list(IMPORTS_ROOT, SWEEP_LIMIT);
  const stale = objects.filter((o) => now - o.updatedAt.getTime() >= minAgeMs);
  let deleted = 0;
  let kept = 0;
  if (apply) {
    for (const o of stale) {
      if (await storage.delete(o.key, o)) deleted++;
      else kept++;
    }
  }
  return { scanned: objects.length, stale: stale.map((o) => o.key), deleted, kept };
}
