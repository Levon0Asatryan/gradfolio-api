import { z } from 'zod';

/**
 * How much text a MySQL column holds, as MySQL counts it (run on 8.4.11, utf8mb4):
 *
 * - `VARCHAR(n)` / `CHAR(n)`: n **characters** (code points). 500 emoji fit
 *   `VARCHAR(500)`, although their JS `.length` is 1000; `z.string().max(n)`
 *   would reject them.
 * - `TEXT`: 65,535 **bytes** of UTF-8 (16,383 emoji fit; 16,384 do not).
 */
export type ColumnLimit = { kind: 'chars'; max: number } | { kind: 'bytes'; max: number };

export const chars = (max: number): ColumnLimit => ({ kind: 'chars', max });
export const TEXT: ColumnLimit = { kind: 'bytes', max: 65_535 };
export const MEDIUMTEXT: ColumnLimit = { kind: 'bytes', max: 16_777_215 };
export const LONGTEXT: ColumnLimit = { kind: 'bytes', max: 4_294_967_295 };

/** Length of `value` in the unit the limit counts. */
export function measure(value: string, limit: ColumnLimit): number {
  return limit.kind === 'chars' ? [...value].length : Buffer.byteLength(value, 'utf8');
}

export function fits(value: string, limit: ColumnLimit): boolean {
  return measure(value, limit) <= limit.max;
}

/** A string no longer than the column holds. */
export function limitedString(limit: ColumnLimit) {
  return z.string().refine((v) => fits(v, limit), {
    message:
      limit.kind === 'chars'
        ? `must be at most ${limit.max} characters`
        : `must be at most ${limit.max} bytes of UTF-8`,
  });
}
