import { newId } from '../../../core/db/ids.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { setProjectTerms } from '../../../core/db/terms.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { lockUser } from '../../../core/db/user-lock.js';
import { ValidationError } from '../../../core/errors/app-error.js';
import { GithubNotLinkedError } from '../../../core/github/errors.js';
import type { GithubRateLimit, GithubRepo } from '../../../core/github/github-client.js';
import { fits } from '../../../core/validation/text.js';
import { COLUMN_LIMITS } from '../../../core/validation/columns.js';
import { type CreateProject, projectWriteSchemas } from '../../projects/dto/project-write.dto.js';
import {
  countOwnedProjects,
  insertImportedProject,
} from '../../projects/repositories/project-write.repository.js';
import type { UserRow } from '../../users/repositories/user.repository.js';
import type { GithubConnect } from '../integrations.constants.js';
import { importedProjectIds, writeSnapshot } from '../repositories/github-import.repository.js';
import {
  descriptionOf,
  fieldsOf,
  hashField,
  mapLimit,
  type ReadmeNote,
} from '../utils/github-fields.js';
import { GithubConnectionService } from './github-connection.service.js';

interface ImportResult {
  repoId: number;
  outcome: 'created' | 'exists' | 'skipped';
  reason:
    | 'not_found'
    | 'not_owner'
    | 'invalid_repository'
    | 'LIMIT_REACHED'
    /** Only when the caller passed `eligible` (a suggestion's accept): the public API never gives it. */
    | 'ineligible'
    | null;
  projectId: string | null;
  notes: ReadmeNote[];
}

interface StaleItem {
  stale: true;
  repoId: number;
}

type Prepared =
  | { kind: 'done'; result: ImportResult }
  /** Found imported before the lock was taken; re-verified under it. */
  | { kind: 'existing'; repoId: number }
  | {
      kind: 'create';
      repo: GithubRepo;
      /** What is stored: GitHub's values with the student's overrides. */
      input: CreateProject;
      /** What GitHub gave, without overrides: what the re-sync snapshot records. */
      github: CreateProject;
      notes: ReadmeNote[];
    };

/** A caller's own test of the freshly read repository, applied before anything is stored. */
export type Eligible = (repo: GithubRepo, githubUserId: number) => boolean;

export type DraftOverrides = Partial<
  Pick<CreateProject, 'title' | 'summary' | 'technologies' | 'links'> & {
    descriptionHtml: string | null;
  }
>;

const NO_LIMIT: GithubRateLimit = { remaining: null, resetsAt: null };

/** An opaque cursor: the page number, so a caller cannot ask GitHub for anything else. */
const encodeCursor = (page: number) => Buffer.from(`p${page}`).toString('base64url');
function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 1;
  const page = /^p([1-9]\d{0,5})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'))?.[1];
  if (page === undefined) {
    throw new ValidationError([{ path: 'cursor', message: 'is not a cursor this API issued' }]);
  }
  return Number(page);
}

/**
 * GitHub repository list and import (docs/modules/m7/plan.md §3.2, §3.3). The only
 * identifiers a caller supplies are integers and an opaque cursor; each
 * repository is read again from GitHub (stars, forks, language, README), and
 * only those the caller owns, or may push to, are imported.
 */
@Injectable()
export class GithubImportService {
  private readonly schemas;

  constructor(
    private readonly dbs: DbService,
    private readonly connection: GithubConnectionService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    this.schemas = projectWriteSchemas({
      maxTags: cfg.PROJECT_MAX_TAGS,
      maxTechnologies: cfg.PROJECT_MAX_TECHNOLOGIES,
      maxLinks: cfg.PROJECT_MAX_LINKS,
      descriptionMaxBytes: cfg.PROJECT_DESCRIPTION_MAX_BYTES,
    });
  }

  /** `GET /v1/me/github/repos`. */
  async list(
    user: UserRow,
    identity: AccessTokenIdentity,
    query: { q?: string | undefined; cursor?: string | undefined; limit?: number | undefined },
  ) {
    if (query.q !== undefined) return this.search(user, identity, query.q, query.cursor);
    const perPage = query.limit ?? this.cfg.GITHUB_PAGE_MAX;
    if (perPage > this.cfg.GITHUB_PAGE_MAX) {
      throw new ValidationError([
        { path: 'limit', message: `must be at most ${this.cfg.GITHUB_PAGE_MAX}` },
      ]);
    }
    const page = decodeCursor(query.cursor);
    const { gh, token } = await this.connection.requireConnected(user, identity);
    const result = await this.github(gh, user, () => gh.github.listRepos(token, { page, perPage }));

    return {
      items: await this.withImported(user.id, result.items),
      nextCursor: result.nextPage === null ? null : encodeCursor(result.nextPage),
      rateLimit: result.rateLimit,
    };
  }

  /**
   * `q`: GitHub cannot search the caller's list, so up to GITHUB_SEARCH_SCAN_PAGES
   * pages of 100 are read from the cursor and every match in them returned;
   * the cursor continues after the last page read. At most that many GitHub
   * calls, and the same `imported` marks.
   */
  private async search(user: UserRow, identity: AccessTokenIdentity, q: string, cursor?: string) {
    let page: number | null = decodeCursor(cursor);
    const { gh, token } = await this.connection.requireConnected(user, identity);
    const needle = q.toLowerCase();
    const matches: GithubRepo[] = [];
    let rateLimit = NO_LIMIT;
    for (let read = 0; page !== null && read < this.cfg.GITHUB_SEARCH_SCAN_PAGES; read++) {
      const current: number = page;
      const result = await this.github(gh, user, () =>
        gh.github.listRepos(token, { page: current, perPage: 100 }),
      );
      rateLimit = result.rateLimit;
      matches.push(
        ...result.items.filter((r) =>
          [r.name, r.description ?? '', r.language ?? ''].some((v) =>
            v.toLowerCase().includes(needle),
          ),
        ),
      );
      page = result.nextPage;
    }
    return {
      items: await this.withImported(user.id, matches),
      nextCursor: page === null ? null : encodeCursor(page),
      rateLimit,
    };
  }

  private async withImported(userId: string, repos: readonly GithubRepo[]) {
    const known = await importedProjectIds(
      this.dbs.db,
      userId,
      repos.map((r) => r.id),
    );
    return repos.map((r) => ({
      repoId: r.id,
      fullName: r.fullName,
      description: r.description,
      language: r.language,
      stars: r.stars,
      forks: r.forks,
      fork: r.fork,
      archived: r.archived,
      pushedAt: r.pushedAt,
      imported: known.has(r.id),
      projectId: known.get(r.id) ?? null,
    }));
  }

  /** `POST /v1/me/github/import`. */
  async import(
    user: UserRow,
    identity: AccessTokenIdentity,
    repoIds: readonly number[],
    overrides: Readonly<Record<string, DraftOverrides>> = {},
    eligible?: Eligible,
  ) {
    this.checkBatch(repoIds);
    const ctx = await this.context(user, identity);
    const already = await importedProjectIds(this.dbs.db, user.id, repoIds);

    // GitHub is asked outside any transaction; nothing here holds a lock. An
    // override that fails the create rules throws before anything is written.
    const prepare = (repoId: number): Promise<Prepared> =>
      this.prepareRepo(ctx, repoId, overrides[String(repoId)], eligible);
    const prepared = await mapLimit(
      repoIds,
      this.cfg.GITHUB_IMPORT_CONCURRENCY,
      (repoId): Promise<Prepared> =>
        already.has(repoId) ? Promise.resolve({ kind: 'existing', repoId }) : prepare(repoId),
    );

    const first = await this.store(user.id, repoIds, prepared);
    // An "existing" project that was deleted between the look and the lock is
    // no longer there: it is prepared like any other, and stored under the lock.
    const stale = first.filter((r): r is StaleItem => 'stale' in r).map((r) => r.repoId);
    const second =
      stale.length === 0
        ? []
        : await this.store(
            user.id,
            stale,
            await mapLimit(stale, this.cfg.GITHUB_IMPORT_CONCURRENCY, prepare),
          );
    const byId = new Map<number, ImportResult>();
    for (const r of [...first, ...second]) if (!('stale' in r)) byId.set(r.repoId, r);
    return { results: repoIds.map((id) => byId.get(id)!), rateLimit: ctx.rateLimit() };
  }

  /**
   * `POST /v1/me/github/import/preview`: the drafts an import would create,
   * read from GitHub the same way, with nothing written. The review step shows
   * them for the student to edit; the save re-reads GitHub (a client's numbers
   * and README are never trusted).
   */
  async preview(user: UserRow, identity: AccessTokenIdentity, repoIds: readonly number[]) {
    this.checkBatch(repoIds);
    const ctx = await this.context(user, identity);
    const already = await importedProjectIds(this.dbs.db, user.id, repoIds);
    const results = await mapLimit(repoIds, this.cfg.GITHUB_IMPORT_CONCURRENCY, async (repoId) => {
      const projectId = already.get(repoId);
      if (projectId !== undefined) {
        return {
          repoId,
          outcome: 'exists' as const,
          reason: null,
          projectId,
          draft: null,
          notes: [],
        };
      }
      const prepared = await this.prepareRepo(ctx, repoId, undefined);
      if (prepared.kind !== 'create') {
        const r = prepared.kind === 'done' ? prepared.result : undefined;
        return {
          repoId,
          outcome: 'skipped' as const,
          reason: (r?.reason ?? 'not_found') as 'not_found' | 'not_owner' | 'invalid_repository',
          projectId: null,
          draft: null,
          notes: [],
        };
      }
      const { input, repo } = prepared;
      return {
        repoId,
        outcome: 'draft' as const,
        reason: null,
        projectId: null,
        draft: {
          title: input.title,
          summary: input.summary,
          descriptionHtml: input.descriptionHtml,
          technologies: input.technologies,
          links: input.links,
          repoUrl: repo.htmlUrl,
          isPublic: input.isPublic,
        },
        notes: prepared.notes,
      };
    });
    return { results, rateLimit: ctx.rateLimit() };
  }

  private checkBatch(repoIds: readonly number[]): void {
    if (repoIds.length > this.cfg.GITHUB_IMPORT_MAX_BATCH) {
      throw new ValidationError([
        { path: 'repoIds', message: `at most ${this.cfg.GITHUB_IMPORT_MAX_BATCH} at once` },
      ]);
    }
  }

  private async context(user: UserRow, identity: AccessTokenIdentity) {
    const { gh, token, githubUserId } = await this.connection.requireConnected(user, identity);
    let rateLimit = NO_LIMIT;
    return {
      gh,
      token,
      githubUserId,
      user,
      note: (r: GithubRateLimit) => {
        rateLimit = r;
      },
      rateLimit: () => rateLimit,
    };
  }

  /**
   * One repository as the draft it would become: read again from GitHub, owned
   * or pushable by the caller, README sanitized, validated by the project
   * create rules; `eligible`, when given, may refuse it first. `overrides` are applied on top and validated the same way; one
   * that fails is a 400 naming `overrides.<repoId>.<field>`.
   */
  private async prepareRepo(
    ctx: Awaited<ReturnType<GithubImportService['context']>>,
    repoId: number,
    overrides: DraftOverrides | undefined,
    eligible?: Eligible,
  ): Promise<Prepared> {
    const { gh, token, user } = ctx;
    const read = await this.github(gh, user, () => gh.github.getRepo(token, repoId));
    ctx.note(read.rateLimit);
    let repo = read.repo;
    if (repo === null) return { kind: 'done', result: done(repoId, 'skipped', 'not_found') };
    // Anyone could otherwise import a famous repository as their own work.
    if (repo.ownerId !== Number(ctx.githubUserId) && !repo.canPush) {
      return { kind: 'done', result: done(repoId, 'skipped', 'not_owner') };
    }
    if (eligible !== undefined && !eligible(repo, Number(ctx.githubUserId))) {
      return { kind: 'done', result: done(repoId, 'skipped', 'ineligible') };
    }
    const got = await this.github(gh, user, () =>
      gh.github.getReadme(token, repoId, this.cfg.GITHUB_README_MAX_BYTES),
    );
    // The limit as of the last call made: the README's, not the repository's.
    if (got.rateLimit !== null) ctx.note(got.rateLimit);
    if (eligible !== undefined) {
      // The README took time: the repository is read once more, and what is stored is
      // what this read says.
      const again = await this.github(gh, user, () => gh.github.getRepo(token, repoId));
      ctx.note(again.rateLimit);
      if (again.repo === null)
        return { kind: 'done', result: done(repoId, 'skipped', 'not_found') };
      if (!eligible(again.repo, Number(ctx.githubUserId))) {
        return { kind: 'done', result: done(repoId, 'skipped', 'ineligible') };
      }
      repo = again.repo;
    }
    const description = descriptionOf(repo, got.readme, this.cfg.PROJECT_DESCRIPTION_MAX_BYTES);
    const base = {
      ...fieldsOf(repo, description.html ?? null),
      category: 'other',
      status: 'ongoing',
      isPublic: !repo.private,
      isDraft: true,
    };
    const github = this.schemas.create.safeParse(base);
    if (!github.success) {
      return { kind: 'done', result: done(repoId, 'skipped', 'invalid_repository') };
    }
    let input = github.data;
    if (overrides !== undefined && Object.keys(overrides).length > 0) {
      const merged = this.schemas.create.safeParse({ ...base, ...overrides });
      if (!merged.success) {
        throw new ValidationError(
          merged.error.issues.map((i) => ({
            path: ['overrides', String(repoId), ...i.path].join('.'),
            message: i.message,
          })),
        );
      }
      input = merged.data;
    }
    return {
      kind: 'create',
      repo,
      input,
      github: github.data,
      notes: description.note === undefined ? [] : [description.note],
    };
  }

  /**
   * One transaction under the user lock: the count, the existing ids and the
   * inserts cannot interleave with a competing import of the same repository
   * (run: without the lock the loser gets 1062, or 1213 when the winner rolls
   * back). Ordered like the request.
   */
  private store(
    userId: string,
    repoIds: readonly number[],
    prepared: readonly Prepared[],
  ): Promise<(ImportResult | StaleItem)[]> {
    return inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      let count = await countOwnedProjects(trx, userId);
      const have = await importedProjectIds(trx, userId, repoIds);
      const results: (ImportResult | StaleItem)[] = [];

      for (const item of prepared) {
        if (item.kind === 'done') {
          results.push(item.result);
          continue;
        }
        if (item.kind === 'existing') {
          // Read again under the lock: a project deleted meanwhile (its delete
          // takes only the project's lock) is not reported as existing.
          const current = have.get(item.repoId);
          results.push(
            current === undefined
              ? { stale: true, repoId: item.repoId }
              : done(item.repoId, 'exists', null, current),
          );
          continue;
        }
        const { repo, input, github, notes } = item;
        const existing = have.get(repo.id);
        if (existing !== undefined) {
          results.push(done(repo.id, 'exists', null, existing));
          continue;
        }
        if (count >= this.cfg.PROJECT_MAX_PER_USER) {
          results.push(done(repo.id, 'skipped', 'LIMIT_REACHED'));
          continue;
        }
        const id = newId();
        await insertImportedProject(trx, userId, id, input, {
          githubRepoId: repo.id,
          stars: repo.stars,
          forks: repo.forks,
          language: fits(repo.language ?? '', COLUMN_LIMITS['projects.repo_language'])
            ? repo.language
            : null,
          readmeUrl: `${repo.htmlUrl}#readme`,
        });
        await setProjectTerms(trx, id, 'technologies', input.technologies);
        // What GitHub gave, not what the student typed: a later re-sync then sees
        // an override as an edit and keeps it (docs/modules/m7/plan.md §3.5).
        await writeSnapshot(trx, id, {
          title: hashField('title', github.title),
          summary: hashField('summary', github.summary),
          descriptionHtml: hashField('descriptionHtml', github.descriptionHtml),
          repoUrl: hashField('repoUrl', github.repoUrl),
          technologies: hashField('technologies', github.technologies),
        });
        count++;
        results.push({ ...done(repo.id, 'created', null, id), notes });
      }
      return results;
    });
  }

  /** A GitHub call; a 401 drops the cached token so the next call reads Auth0 again. */
  private async github<T>(gh: GithubConnect, user: UserRow, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof GithubNotLinkedError) gh.tokens.forget(user.auth0Id);
      throw err;
    }
  }
}

function done(
  repoId: number,
  outcome: ImportResult['outcome'],
  reason: ImportResult['reason'],
  projectId: string | null = null,
): ImportResult {
  return { repoId, outcome, reason, projectId, notes: [] };
}
