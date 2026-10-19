import type { GithubReadme, GithubRepo } from '../../../core/github/github-client.js';
import { readmeToDescription } from '../../../core/github/readme.js';
export { hashField, SYNCED_FIELDS, type SyncedField } from '../../../core/github/snapshot.js';
import { LONGTEXT, measure } from '../../../core/validation/text.js';

/**
 * The project fields a GitHub repository fills and a re-sync may update
 * (docs/modules/m7/plan.md §3.5), and the hash that tells whether a field is still as
 * the import wrote it.
 */

export interface GithubFieldValues {
  title: string;
  summary: string | null;
  /** `undefined`: GitHub's README could not be used (too large); the field is left alone. */
  descriptionHtml: string | null | undefined;
  repoUrl: string;
  technologies: string[];
}

export type ReadmeNote = 'README_TOO_LARGE';

/** At most `max` code points. */
export function cutChars(value: string, max: number): string {
  const points = [...value];
  return points.length <= max ? value : points.slice(0, max).join('');
}

/** At most `max` UTF-8 bytes, cut on a code point. */
export function cutBytes(value: string, max: number): string {
  if (Buffer.byteLength(value, 'utf8') <= max) return value;
  let out = '';
  let bytes = 0;
  for (const ch of value) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > max) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/** The description for a README, and the note when it had to be left out. */
export function descriptionOf(
  repo: GithubRepo,
  readme: GithubReadme | null | 'too_large',
  maxBytes: number,
): { html: string | null | undefined; note?: ReadmeNote } {
  if (readme === null) return { html: null };
  if (readme === 'too_large') return { html: undefined, note: 'README_TOO_LARGE' };
  const html = readmeToDescription(readme.html, {
    owner: repo.ownerLogin,
    repo: repo.name,
    ref: repo.defaultBranch,
    path: readme.path,
  });
  if (html.trim() === '') return { html: null };
  // Never truncated: cutting HTML would leave an unbalanced tree.
  if (measure(html, LONGTEXT) > maxBytes) return { html: undefined, note: 'README_TOO_LARGE' };
  return { html };
}

export function fieldsOf(
  repo: GithubRepo,
  description: string | null | undefined,
): GithubFieldValues {
  return {
    title: cutChars(repo.name, 500),
    summary: repo.description === null ? null : cutBytes(repo.description.trim(), 60_000) || null,
    descriptionHtml: description,
    repoUrl: repo.htmlUrl,
    technologies: repo.language === null ? [] : [repo.language],
  };
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping the order of the results. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
