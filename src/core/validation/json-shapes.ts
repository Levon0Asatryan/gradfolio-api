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

/** `NotificationParams`: notifications.params. Names are snapshots, so they are capped like the columns they came from. */
export const notificationParams = z.strictObject({
  actorId: z.string().max(36).nullish(),
  actorName: z.string().min(1).max(255),
  projectId: z.string().max(36),
  projectTitle: z.string().min(1).max(255),
  role: z.string().max(255).nullish(),
});

/** `GithubImportSnapshot`: project_github_imports.snapshot, a SHA-256 (hex) per synced field. */
export const githubImportSnapshot = z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/));

/** `GithubProfileSnapshot`: integrations.profile_snapshot, GitHub's public profile fields as last read. */
export const githubProfileSnapshotSchema = z.strictObject({
  name: z.string().max(2000).nullable().optional(),
  bio: z.string().max(70_000).nullable(),
  location: z.string().max(2000).nullable(),
  company: z.string().max(2000).nullable(),
  avatarUrl: z.string().max(2000).nullable(),
  blog: z.string().max(2000).nullable(),
  htmlUrl: z.string().max(2000).nullable(),
});
