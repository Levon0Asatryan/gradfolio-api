import type { Database } from './database.js';
import { sanitizeDescription } from '../validation/html.js';

export interface ResanitizeResult {
  scanned: number;
  /** Rows whose stored value differs from its sanitized form; with `apply`, the rows actually rewritten. */
  changed: number;
  /** With `apply`: rows that changed under us (compare-and-set missed); run it again. */
  skipped: number;
}

/**
 * Re-runs the description sanitizer over stored rows, for when the allow-list
 * changes (docs/m4-plan.md §4.1). The sanitizer is idempotent, so a second run
 * changes nothing. `apply: false` only counts; with `apply`, a row that changed
 * between the read and the write is reported as skipped, not rewritten. Output that sanitizes to nothing
 * becomes NULL, as on write.
 */
export async function resanitizeDescriptions(
  db: Database,
  {
    apply,
    beforeWrite,
  }: {
    apply: boolean;
    /** Test seam: runs after a row is read and before it is written, to force a competing writer. */
    beforeWrite?: (id: string) => Promise<void>;
  },
): Promise<ResanitizeResult> {
  let scanned = 0;
  let changed = 0;
  let skipped = 0;
  let after = '';
  for (;;) {
    const rows = await db
      .selectFrom('projects')
      .select(['id', 'descriptionHtml'])
      .where('descriptionHtml', 'is not', null)
      .where('id', '>', after)
      .orderBy('id')
      .limit(100)
      .execute();
    if (rows.length === 0) return { scanned, changed, skipped };
    for (const row of rows) {
      scanned++;
      const clean = sanitizeDescription(row.descriptionHtml ?? '');
      if (clean === row.descriptionHtml) continue;
      if (!apply) {
        changed++;
        continue;
      }
      await beforeWrite?.(row.id);
      const result = await db
        .updateTable('projects')
        .set({ descriptionHtml: clean.trim() === '' ? null : clean })
        .where('id', '=', row.id)
        .where('descriptionHtml', '=', row.descriptionHtml)
        .executeTakeFirst();
      // A writer got there first: the row is not ours to count as rewritten.
      if (Number(result.numUpdatedRows) === 0) skipped++;
      else changed++;
    }
    after = rows.at(-1)!.id;
  }
}
