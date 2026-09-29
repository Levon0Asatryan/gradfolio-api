import type { ColumnType } from 'kysely';

/**
 * Column types the generated row types (types.generated.ts) are overridden
 * with, per `.kysely-codegenrc.json`. They encode rules the database alone does
 * not: booleans are booleans, JSON has a shape, DATE is a calendar date.
 */

declare const validated: unique symbol;

/**
 * JSON text that has passed the column's zod schema. Only `toJsonColumn`
 * produces it, and JSON columns accept nothing else on insert or update, so a
 * value cannot reach a JSON column unvalidated -- MySQL itself accepts any
 * valid JSON there (the CHECKs catch the shape, not the rest of the rules).
 */
export type JsonText<T> = string & { readonly [validated]: T };

/** A JSON column: read back parsed (mysql2 parses JSON), written as `JsonText`. */
export type JsonColumn<T> = ColumnType<
  T | null,
  JsonText<T> | null | undefined,
  JsonText<T> | null
>;

/** `TINYINT(1) NOT NULL DEFAULT …`, read as a boolean (the pool's typeCast). */
export type Bool = ColumnType<boolean, boolean | undefined, boolean>;

/** `DATE NULL`, read and written as `YYYY-MM-DD` (the pool's `dateStrings: ['DATE']`). */
export type DateText = ColumnType<string | null, string | null | undefined, string | null>;

export type StringList = string[];
export type LinkList = { label: string; url: string }[];
export type TranslationParams = Record<string, string | number>;
