import { z } from 'zod';

/** The orders a project list may use. Each ends in `id`, in the same direction, so every order is total. */
export const PROJECT_SORTS = ['newest', 'oldest', 'updated', 'name_asc', 'name_desc'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export interface SortSpec {
  column: 'createdAt' | 'updatedAt' | 'title';
  direction: 'asc' | 'desc';
  /** `date` cursors hold epoch milliseconds, `text` ones the title. */
  kind: 'date' | 'text';
}

export const SORTS: Record<ProjectSort, SortSpec> = {
  newest: { column: 'createdAt', direction: 'desc', kind: 'date' },
  oldest: { column: 'createdAt', direction: 'asc', kind: 'date' },
  updated: { column: 'updatedAt', direction: 'desc', kind: 'date' },
  name_asc: { column: 'title', direction: 'asc', kind: 'text' },
  name_desc: { column: 'title', direction: 'desc', kind: 'text' },
};

export interface Cursor {
  /** The last row's sort value: epoch ms, or the title. */
  v: number | string;
  id: string;
}

const cursorSchema = z.strictObject({
  s: z.enum(PROJECT_SORTS),
  v: z.union([z.number().int().nonnegative(), z.string().max(500)]),
  id: z.string().max(36),
});

export function encodeCursor(sort: ProjectSort, cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ s: sort, v: cursor.v, id: cursor.id })).toString('base64url');
}

/** The cursor for `sort`, or `undefined` for anything else: malformed, forged, or made for another order. */
export function decodeCursor(raw: string, sort: ProjectSort): Cursor | undefined {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success || parsed.data.s !== sort) return undefined;
  const wantsNumber = SORTS[sort].kind === 'date';
  if ((typeof parsed.data.v === 'number') !== wantsNumber) return undefined;
  return { v: parsed.data.v, id: parsed.data.id };
}
