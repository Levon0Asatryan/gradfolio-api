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

/** What a notification renders from (docs/modules/m5/plan.md §5.1): names snapshotted when it was written. */
export interface NotificationParams {
  actorId?: string | null;
  actorName: string;
  projectId: string;
  projectTitle: string;
  role?: string | null;
}

/**
 * `project_github_imports.snapshot` (docs/modules/m7/plan.md §3.5): per synced field, the
 * SHA-256 (hex) of the value as last written by an import or re-sync.
 */
export type GithubImportSnapshot = Record<string, string>;

/**
 * `suggestions.payload` (docs/modules/m7/plan.md §6.4): what the suggestion proposes,
 * validated by the suggestion's kind when it is written. Always an object.
 */
export type SuggestionPayload = Record<string, unknown>;

/**
 * `integrations.profile_snapshot`: GitHub's public profile fields as last read
 * (docs/modules/m7/plan.md §6.3). Public data of the student's own account, not a token.
 */
export interface GithubProfileSnapshot {
  name?: string | null;
  bio: string | null;
  location: string | null;
  company: string | null;
  avatarUrl: string | null;
  blog: string | null;
  htmlUrl: string | null;
}
