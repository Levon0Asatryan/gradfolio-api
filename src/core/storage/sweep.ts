import type { Database } from '../db/database.js';
import { objectKeyOf } from './file-rules.js';
import type { FileStorage } from './file-storage.js';

export interface SweepResult {
  /** Objects looked at under `u/`. */
  scanned: number;
  /** Objects no row references, old enough to go. */
  orphans: string[];
  /** Orphans actually deleted (always 0 on a dry run). */
  deleted: number;
}

/** More objects than this bucket can plausibly hold; the sweep reads at most this many. */
const SWEEP_LIMIT = 100_000;

/**
 * Finds objects that no row points at -- an upload never registered, a claim
 * whose transaction rolled back, a delete that failed (docs/m4-plan.md §3.5) --
 * and deletes those older than `minAgeMs`. The age floor is what keeps a file
 * that was just claimed, with its row not yet committed, from being taken.
 * Only the `u/` prefix is looked at. `apply: false` reports and deletes nothing.
 */
export async function sweepOrphans(
  db: Database,
  storage: FileStorage,
  bucket: string,
  { apply, minAgeMs, now = Date.now() }: { apply: boolean; minAgeMs: number; now?: number },
): Promise<SweepResult> {
  const referenced = new Set<string>();
  const add = (url: string | null) => {
    const key = url === null ? null : objectKeyOf(url, bucket);
    if (key !== null) referenced.add(key);
  };
  for (const r of await db.selectFrom('users').select('avatarUrl').execute()) add(r.avatarUrl);
  for (const r of await db.selectFrom('projects').select('heroImageUrl').execute()) {
    add(r.heroImageUrl);
  }
  for (const r of await db
    .selectFrom('projectAttachments')
    .select(['url', 'thumbnailUrl'])
    .execute()) {
    add(r.url);
    add(r.thumbnailUrl);
  }

  const objects = await storage.list('u/', SWEEP_LIMIT);
  const orphans = objects
    .filter((o) => !referenced.has(o.key) && now - o.updatedAt.getTime() >= minAgeMs)
    .map((o) => o.key);
  let deleted = 0;
  if (apply) {
    for (const key of orphans) {
      await storage.delete(key);
      deleted++;
    }
  }
  return { scanned: objects.length, orphans, deleted };
}
