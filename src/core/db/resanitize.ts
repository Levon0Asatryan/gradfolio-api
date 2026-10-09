import type { Database } from './database.js';
import { sanitizeDescription } from '../validation/html.js';

export interface ResanitizeResult {
  scanned: number;
  changed: number;
}

/**
 * Re-runs the description sanitizer over stored rows, for when the allow-list
 * changes (docs/m4-plan.md §4.1). The sanitizer is idempotent, so a second run
 * changes nothing. `apply: false` only counts. Output that sanitizes to nothing
 * becomes NULL, as on write.
 */
export async function resanitizeDescriptions(
  db: Database,
  { apply }: { apply: boolean },
): Promise<ResanitizeResult> {
  let scanned = 0;
  let changed = 0;
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
    if (rows.length === 0) return { scanned, changed };
    for (const row of rows) {
      scanned++;
      const clean = sanitizeDescription(row.descriptionHtml ?? '');
      if (clean === row.descriptionHtml) continue;
      changed++;
      if (apply) {
        await db
          .updateTable('projects')
          .set({ descriptionHtml: clean.trim() === '' ? null : clean })
          .where('id', '=', row.id)
          .where('descriptionHtml', '=', row.descriptionHtml)
          .execute();
      }
    }
    after = rows.at(-1)!.id;
  }
}
