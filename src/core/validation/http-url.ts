import { z } from 'zod';
import { type ColumnLimit, fits, TEXT } from './text.js';

const ALLOWED = new Set(['http:', 'https:']);

/**
 * An absolute http(s) URL, at most `limit` long. Every user-supplied URL is
 * rendered as a link or an image source; `javascript:` or `data:` there is
 * script injection, and a relative path points into our own site.
 */
export function httpUrl(limit: ColumnLimit = TEXT) {
  return z
    .string()
    .refine((v) => fits(v, limit), { message: `must fit its column (${limit.max} ${limit.kind})` })
    .refine(isHttpUrl, { message: 'must be an absolute http or https URL' });
}

export function isHttpUrl(value: string): boolean {
  try {
    return ALLOWED.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
