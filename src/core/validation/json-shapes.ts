import { z } from 'zod';
import { httpUrl } from './http-url.js';
import { chars, limitedString } from './text.js';

/**
 * Schemas for the JSON columns. MySQL accepts any valid JSON there; the CHECKs
 * in 0002_value_checks catch a wrong shape, these catch the rest (empty items,
 * lengths, URL schemes). Write through `toJsonColumn(schema, value)`.
 *
 * A JSON value has no per-item column limit, so items are capped here: long
 * enough for any real highlight or link, short enough that one field cannot
 * fill a row. Endpoints can tighten them.
 */
export const LIST_ITEM_LIMIT = chars(1000);
export const LINK_LABEL_LIMIT = chars(200);
export const LINK_URL_LIMIT = chars(2048);

const item = limitedString(LIST_ITEM_LIMIT)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'must not be empty' });

/** `string[]`: education.highlights, experience.achievements. */
export function stringList({ maxItems }: { maxItems: number }) {
  return z.array(item).max(maxItems);
}

/** `{label, url}[]`: projects.links, projects.files. */
export function linkList({ maxItems }: { maxItems: number }) {
  return z
    .array(
      z.strictObject({
        label: limitedString(LINK_LABEL_LIMIT)
          .transform((v) => v.trim())
          .refine((v) => v.length > 0, { message: 'must not be empty' }),
        url: httpUrl(LINK_URL_LIMIT),
      }),
    )
    .max(maxItems);
}

/** `Record<string, string | number>`: activities.translation_params. */
export const translationParams = z.record(z.string(), z.union([z.string(), z.number().finite()]));
