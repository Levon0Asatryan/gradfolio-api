import { z } from 'zod';

/**
 * Keyset cursor for lists ordered newest first by `(time column, id)`: the last
 * row's time (epoch ms) and id. The order always ends in `id` in the same
 * direction, so it is total and a page never repeats or skips a row.
 */
export interface TimeCursor {
  t: number;
  id: string;
}

/**
 * A page that holds several lists (`GET /me/teams`) names the list in its
 * cursors (`scope`), so one list's cursor is a 400 on another instead of a page
 * from the wrong place. Lists with a single cursor pass no scope.
 */

const cursorSchema = z.strictObject({
  // Up to 9999-12-31T23:59:59.999Z, the last time a MySQL DATETIME holds (and well inside
  // a JavaScript Date): a later one reaches the database as an invalid datetime, a 500.
  t: z.number().int().nonnegative().max(253_402_300_799_999),
  id: z.string().max(36),
  s: z.string().max(20).optional(),
});

export const encodeTimeCursor = (c: TimeCursor, scope?: string): string =>
  Buffer.from(
    JSON.stringify({ t: c.t, id: c.id, ...(scope === undefined ? {} : { s: scope }) }),
  ).toString('base64url');

/** The cursor, or `undefined` for anything malformed or forged. */
export function decodeTimeCursor(raw: string, scope?: string): TimeCursor | undefined {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success || parsed.data.s !== scope) return undefined;
  return { t: parsed.data.t, id: parsed.data.id };
}
