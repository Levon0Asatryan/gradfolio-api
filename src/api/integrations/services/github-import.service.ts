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
  reason: 'not_found' | 'not_owner' | 'invalid_repository' | 'LIMIT_REACHED' | null;
  projectId: string | null;
  notes: ReadmeNote[];
}

type Prepared =
  | { kind: 'done'; result: ImportResult }
  | { kind: 'create'; repo: GithubRepo; input: CreateProject; notes: ReadmeNote[] };

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
 * GitHub repository list and import (docs/m7-plan.md §3.2, §3.3). The only
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
    query: { cursor?: string | undefined; limit?: number | undefined },
  ) {
    const perPage = query.limit ?? this.cfg.GITHUB_PAGE_MAX;
    if (perPage > this.cfg.GITHUB_PAGE_MAX) {
      throw new ValidationError([
        { path: 'limit', message: `must be at most ${this.cfg.GITHUB_PAGE_MAX}` },
      ]);
    }
    const page = decodeCursor(query.cursor);
    const { gh, token } = await this.connection.requireConnected(user, identity);
    const result = await this.github(gh, user, () => gh.github.listRepos(token, { page, perPage }));

    const known = await importedProjectIds(
      this.dbs.db,
      user.id,
      result.items.map((r) => r.id),
    );
    return {
      items: result.items.map((r) => ({
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
      })),
      nextCursor: result.nextPage === null ? null : encodeCursor(result.nextPage),
      rateLimit: result.rateLimit,
    };
  }

  /** `POST /v1/me/github/import`. */
  async import(user: UserRow, identity: AccessTokenIdentity, repoIds: readonly number[]) {
    if (repoIds.length > this.cfg.GITHUB_IMPORT_MAX_BATCH) {
      throw new ValidationError([
        { path: 'repoIds', message: `at most ${this.cfg.GITHUB_IMPORT_MAX_BATCH} at once` },
      ]);
    }
    const { gh, token, githubUserId } = await this.connection.requireConnected(user, identity);
    const already = await importedProjectIds(this.dbs.db, user.id, repoIds);
    let rateLimit = NO_LIMIT;

    // GitHub is asked outside any transaction; nothing here holds a lock.
    const prepared = await mapLimit(
      repoIds,
      this.cfg.GITHUB_IMPORT_CONCURRENCY,
      async (repoId): Promise<Prepared> => {
        const projectId = already.get(repoId);
        if (projectId !== undefined) {
          return { kind: 'done', result: done(repoId, 'exists', null, projectId) };
        }
        const read = await this.github(gh, user, () => gh.github.getRepo(token, repoId));
        rateLimit = read.rateLimit;
        const repo = read.repo;
        if (repo === null) return { kind: 'done', result: done(repoId, 'skipped', 'not_found') };
        // Anyone could otherwise import a famous repository as their own work.
        if (repo.ownerId !== Number(githubUserId) && !repo.canPush) {
          return { kind: 'done', result: done(repoId, 'skipped', 'not_owner') };
        }
        const readme = await this.github(gh, user, () =>
          gh.github.getReadme(token, repoId, this.cfg.GITHUB_README_MAX_BYTES),
        );
        const description = descriptionOf(repo, readme, this.cfg.PROJECT_DESCRIPTION_MAX_BYTES);
        const parsed = this.schemas.create.safeParse({
          ...fieldsOf(repo, description.html ?? null),
          category: 'other',
          status: 'ongoing',
          isPublic: !repo.private,
          isDraft: true,
        });
        if (!parsed.success) {
          return { kind: 'done', result: done(repoId, 'skipped', 'invalid_repository') };
        }
        return {
          kind: 'create',
          repo,
          input: parsed.data,
          notes: description.note === undefined ? [] : [description.note],
        };
      },
    );

    const results = await this.store(user.id, repoIds, prepared);
    return { results, rateLimit };
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
  ): Promise<ImportResult[]> {
    return inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      let count = await countOwnedProjects(trx, userId);
      const have = await importedProjectIds(trx, userId, repoIds);
      const results: ImportResult[] = [];

      for (const item of prepared) {
        if (item.kind === 'done') {
          results.push(item.result);
          continue;
        }
        const { repo, input, notes } = item;
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
        const technologies = await setProjectTerms(trx, id, 'technologies', input.technologies);
        await writeSnapshot(trx, id, {
          title: hashField('title', input.title),
          summary: hashField('summary', input.summary),
          descriptionHtml: hashField('descriptionHtml', input.descriptionHtml),
          repoUrl: hashField('repoUrl', input.repoUrl),
          technologies: hashField('technologies', technologies),
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
