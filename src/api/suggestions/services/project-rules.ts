import type { GithubRepo } from '../../../core/github/github-client.js';
import { hashField } from '../../../core/github/snapshot.js';

/**
 * Repository-change suggestions (docs/modules/m7/plan.md §6.6e): pure rules, no I/O.
 *
 * `project.new`: an own public repository the student has not imported.
 * `project.update`: an imported project whose description or README changed on
 * GitHub since the snapshot, while the student's field is still what the import
 * (or last re-sync) wrote. A field the student edited is never offered and an
 * accept never writes over it: the re-sync reports that conflict, not this.
 * Stars and forks are silent (D8): a re-sync refreshes them.
 */

/** The project fields a suggestion may update: GitHub's description and README. */
export const PROJECT_FIELDS = ['summary', 'descriptionHtml'] as const;
export type ProjectField = (typeof PROJECT_FIELDS)[number];

/** A push this close before the snapshot's write may not be in the README that was read. */
export const PUSH_MARGIN_MS = 60_000;

export interface WantedProjectRow {
  kind: 'project.new' | 'project.update';
  dedupeKey: string;
  targetId: string | null;
  payload: Record<string, unknown>;
}

export const newRepoKey = (repoId: number): string => `repo:${repoId}:new`;

/** The hash is of the proposed value, so a new upstream value is a new key (a dismissed one stays dismissed). */
export const updateKey = (projectId: string, field: ProjectField, upstreamHash: string): string =>
  `project:${projectId}:${field}:${upstreamHash.slice(0, 16)}`;

/**
 * The student's own work on GitHub: public, not a fork, not archived, owned by the
 * connected account. One test for the offer, the refresh that withdraws it and the accept.
 */
export const isOffered = (repo: GithubRepo, githubUserId: number): boolean =>
  repo.ownerId === githubUserId && !repo.private && !repo.fork && !repo.archived;

/**
 * The repositories to offer as new: own, not imported, the newest `limit` in the
 * list's order (most recently pushed first). A dismissed one still takes its place,
 * so dismissing never summons the next.
 */
export function newRepoRows(
  page: readonly GithubRepo[],
  githubUserId: number,
  imported: ReadonlySet<number>,
  limit: number,
): WantedProjectRow[] {
  return page
    .filter((r) => isOffered(r, githubUserId) && !imported.has(r.id))
    .slice(0, limit)
    .map((r) => ({
      kind: 'project.new',
      dedupeKey: newRepoKey(r.id),
      targetId: null,
      payload: {
        repoId: r.id,
        fullName: r.fullName,
        name: r.name,
        description: r.description,
        language: r.language,
      },
    }));
}

/** An imported project as it stands, read under its row lock. */
export interface ProjectNow {
  projectId: string;
  title: string;
  summary: string | null;
  descriptionHtml: string | null;
  /** SHA-256 per synced field as last written by an import, a re-sync or an accept. */
  snapshot: Readonly<Record<string, string>>;
}

export const valueOf = (p: ProjectNow, field: ProjectField): string | null => p[field];

/** Still as GitHub last wrote it: the student has not touched the field. */
export const isUntouched = (p: ProjectNow, field: ProjectField): boolean => {
  const wrote = p.snapshot[field];
  return wrote !== undefined && hashField(field, valueOf(p, field)) === wrote;
};

/** What GitHub says now for fields that were read: `undefined` is "not read this time". */
export type Upstream = Partial<Record<ProjectField, string | null>>;

/**
 * Updates to offer: a field read just now that differs from the snapshot while the
 * project's value still equals it. A removed description or README (null) is not
 * offered: an accept would clear what the student has.
 */
export function updateRows(
  projects: ReadonlyMap<string, ProjectNow>,
  upstream: ReadonlyMap<string, { repoId: number; fullName: string; values: Upstream }>,
): WantedProjectRow[] {
  const rows: WantedProjectRow[] = [];
  for (const [projectId, { repoId, fullName, values }] of upstream) {
    const now = projects.get(projectId);
    if (now === undefined) continue;
    for (const field of PROJECT_FIELDS) {
      const value = values[field];
      const base = now.snapshot[field];
      if (typeof value !== 'string' || base === undefined) continue;
      const hash = hashField(field, value);
      if (hash === base || !isUntouched(now, field)) continue;
      rows.push({
        kind: 'project.update',
        dedupeKey: updateKey(projectId, field, hash),
        targetId: projectId,
        payload: { field, value, baseHash: base, repoId, fullName, title: now.title },
      });
    }
  }
  return rows;
}

/**
 * An open update that can no longer be applied, from the project alone: the project
 * is gone, a re-sync or an accept moved the snapshot, or the student edited the field.
 */
export function isUpdateStale(
  payload: { field?: unknown; baseHash?: unknown },
  now: ProjectNow | undefined,
): boolean {
  const field = PROJECT_FIELDS.find((f) => f === payload.field);
  if (now === undefined || field === undefined) return true;
  return now.snapshot[field] !== payload.baseHash || !isUntouched(now, field);
}

/** A README is read only for a project pushed to since its snapshot was written. */
export const mayHaveChanged = (pushedAt: string | null, syncedAt: Date): boolean => {
  if (pushedAt === null) return true;
  const pushed = Date.parse(pushedAt);
  return Number.isNaN(pushed) || pushed >= syncedAt.getTime() - PUSH_MARGIN_MS;
};
