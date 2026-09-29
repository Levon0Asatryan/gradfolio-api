import { z } from 'zod';
import { chars, fits } from './text.js';

/**
 * A skill, technology or tag, normalized: NFC, trimmed, whitespace runs (tab,
 * NBSP, U+3000 …) collapsed to one space. Case is kept -- the database matches
 * case-insensitively and `canonicalizeTerms` picks the stored spelling.
 */
export function normalizeTerm(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

/**
 * The same rule in SQL, for data MySQL must normalize itself (migration 0003).
 * MySQL has no NFC; its collation compares NFC and NFD equal (run), so the key
 * is the same either way. terms.int.test.ts proves the two agree.
 */
export const SQL_NORMALIZE = (expr: string) => `TRIM(REGEXP_REPLACE(${expr}, '[[:space:]]+', ' '))`;

/** The term columns are VARCHAR(255). */
export const TERM_LIMIT = chars(255);

export const term = z
  .string()
  .transform(normalizeTerm)
  .refine((v) => v.length > 0, { message: 'must not be empty' })
  .refine((v) => fits(v, TERM_LIMIT), { message: 'must be at most 255 characters' });

/**
 * A list of terms, normalized, with case-insensitive duplicates dropped (the
 * first spelling stays). For a list stored in a table the database's key is the
 * final word (it also folds accents); this keeps JSON lists
 * (experience.skills) free of the obvious duplicates.
 */
export function termList({ maxItems }: { maxItems: number }) {
  return z
    .array(term)
    .max(maxItems)
    .transform((names) => {
      const seen = new Set<string>();
      return names.filter((n) => {
        const key = n.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
}
