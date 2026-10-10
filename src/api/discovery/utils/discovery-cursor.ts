import { z } from 'zod';

/**
 * Keyset cursor for discovery lists: `(rank, time, id)` for ranked search,
 * `(time, id)` for lists in time order. `s` names the list, so one list's
 * cursor is a 400 on another.
 *
 * Not authenticated, by design (docs/m6-plan.md §3.1): it only positions a
 * comparison inside a statement that re-applies the query's predicates and the
 * visibility predicates, so a forged one can skip or repeat rows of the
 * forger's own listing and nothing more.
 */
export interface DiscoveryCursor {
  /** Rank 0 to 3; absent for time-ordered lists. */
  r?: number;
  /** Epoch milliseconds of the last row's `created_at`. */
  t: number;
  id: string;
}

const schema = z.strictObject({
  r: z.number().int().min(0).max(3).optional(),
  // Up to 9999-12-31T23:59:59.999Z, the last time a MySQL DATETIME holds.
  t: z.number().int().nonnegative().max(253_402_300_799_999),
  id: z.string().min(1).max(36),
  s: z.string().max(40),
});

export const CURSOR_MAX_CHARS = 600;

export function encodeCursor(scope: string, c: DiscoveryCursor): string {
  return Buffer.from(JSON.stringify({ ...c, s: scope })).toString('base64url');
}

/** The cursor, or `undefined` for anything malformed, out of range, or made for another list. */
export function decodeCursor(
  raw: string,
  scope: string,
  ranked: boolean,
): DiscoveryCursor | undefined {
  if (raw.length > CURSOR_MAX_CHARS) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success || parsed.data.s !== scope) return undefined;
  if (ranked !== (parsed.data.r !== undefined)) return undefined;
  const { r, t, id } = parsed.data;
  return r === undefined ? { t, id } : { r, t, id };
}
