import { z } from 'zod';
import { columnString } from '../../../core/validation/columns.js';
import { httpUrl } from '../../../core/validation/http-url.js';
import { chars, fits } from '../../../core/validation/text.js';

/** Field building blocks shared by the profile header and the section items. */

const emptyToNull = (v: string): string | null => (v === '' ? null : v);

/** A trimmed string that fits the column; used for required text. */
export const text = (column: Parameters<typeof columnString>[0]) =>
  z.string().trim().pipe(columnString(column));

/** Nullable text: `null` or a blank string clears the field. */
export const nullableText = (column: Parameters<typeof columnString>[0]) =>
  z.union([
    z.null(),
    z
      .string()
      .trim()
      .transform(emptyToNull)
      .pipe(z.union([z.null(), columnString(column)])),
  ]);

/** A nullable `http(s)` URL: `null` or a blank string clears the field. */
export const nullableUrl = (limit: Parameters<typeof httpUrl>[0]) =>
  z.union([
    z.null(),
    z
      .string()
      .trim()
      .transform(emptyToNull)
      .pipe(z.union([z.null(), httpUrl(limit)])),
  ]);

const CONTACT_EMAIL_LIMIT = chars(255);
export const nullableEmail = z.union([
  z.null(),
  z
    .string()
    .trim()
    .transform(emptyToNull)
    .pipe(
      z.union([
        z.null(),
        z.email().refine((v) => fits(v, CONTACT_EMAIL_LIMIT), {
          message: 'must be at most 255 characters',
        }),
      ]),
    ),
]);

/** A required, non-empty trimmed string that fits the column. */
export const requiredText = (column: Parameters<typeof columnString>[0]) =>
  text(column).refine((v) => v.length > 0, { message: 'must not be empty' });
