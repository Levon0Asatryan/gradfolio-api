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

const cursorSchema = z.strictObject({
  // Up to 9999-12-31T23:59:59.999Z, the last time a MySQL DATETIME holds (and well inside
  // a JavaScript Date): a later one reaches the database as an invalid datetime, a 500.
  t: z.number().int().nonnegative().max(253_402_300_799_999),
  id: z.string().max(36),
});

export const encodeTimeCursor = (c: TimeCursor): string =>
  Buffer.from(JSON.stringify({ t: c.t, id: c.id })).toString('base64url');

/** The cursor, or `undefined` for anything malformed or forged. */
export function decodeTimeCursor(raw: string): TimeCursor | undefined {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = cursorSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}
