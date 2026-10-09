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
  /** Orphans kept because they changed after they were listed (registered or replaced meanwhile). */
  kept: number;
}

/** More objects than this bucket can plausibly hold; the sweep reads at most this many. */
const SWEEP_LIMIT = 100_000;

/**
 * Finds objects that no row points at -- an upload never registered, a claim
 * whose transaction rolled back, a delete that failed (docs/m4-plan.md §3.5) --
 * and deletes those older than `minAgeMs`. The age floor is what keeps a file
 * that was just claimed, with its row not yet committed, from being taken.
 * Only the `u/` prefix is looked at. `apply: false` reports and deletes nothing.
 * An orphan that changed after it was listed is kept and counted, not deleted.
 */
export async function sweepOrphans(
  db: Database,
  storage: FileStorage,
  bucket: string,
  { apply, minAgeMs, now = Date.now() }: { apply: boolean; minAgeMs: number; now?: number },
): Promise<SweepResult> {
  // List first, read the references second, delete third, and delete only the exact
  // version that was listed. An object registered after the listing has a new
  // metageneration (the claim), so its delete is refused; one registered before it
  // has had its `updatedAt` refreshed by the claim, so the age floor holds it back
  // until its row has long been committed.
  const objects = await storage.list('u/', SWEEP_LIMIT);

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

  const orphans = objects.filter(
    (o) => !referenced.has(o.key) && now - o.updatedAt.getTime() >= minAgeMs,
  );
  let deleted = 0;
  let kept = 0;
  if (apply) {
    for (const o of orphans) {
      if (await storage.delete(o.key, o)) deleted++;
      else kept++;
    }
  }
  return { scanned: objects.length, orphans: orphans.map((o) => o.key), deleted, kept };
}
