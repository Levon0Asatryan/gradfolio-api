import { createHash } from 'node:crypto';

/**
 * The project fields a GitHub repository fills and a re-sync may update
 * (docs/m7-plan.md §3.5), and the hash that tells whether a field is still as
 * the import wrote it (`project_github_imports.snapshot`).
 */
export const SYNCED_FIELDS = [
  'title',
  'summary',
  'descriptionHtml',
  'repoUrl',
  'technologies',
] as const;
export type SyncedField = (typeof SYNCED_FIELDS)[number];

/** SHA-256 of a field's value, as stored in the snapshot. Technologies compare as a set. */
export function hashField(field: SyncedField, value: string | string[] | null): string {
  const canonical = Array.isArray(value) ? [...value].map((v) => v.toLowerCase()).sort() : value;
  return createHash('sha256')
    .update(JSON.stringify([field, canonical]))
    .digest('hex');
}
