import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { lockUser } from '../../../core/db/user-lock.js';
import type { DB } from '../../../core/db/types.generated.js';
import { ConflictError, NotFoundError } from '../../../core/errors/app-error.js';
import type { GithubClient, GithubRepo } from '../../../core/github/github-client.js';
import type { GithubAccessToken } from '../../../core/github/github-access-token.js';
import { hashField } from '../../../core/github/snapshot.js';
import { GithubImportService } from '../../integrations/services/github-import.service.js';
import {
  readSnapshot,
  writeSnapshot,
} from '../../integrations/repositories/github-import.repository.js';
import { descriptionOf, fieldsOf, mapLimit } from '../../integrations/utils/github-fields.js';
import { projectWriteSchemas } from '../../projects/dto/project-write.dto.js';
import {
  lockOwnedProject,
  updateOwnedProject,
} from '../../projects/repositories/project-write.repository.js';
import type { UserRow } from '../../users/repositories/user.repository.js';
import type { ResolveResponse } from '../dto/suggestion.dto.js';
import { importedProjects } from '../repositories/project-change.repository.js';
import {
  lockSuggestion,
  markAccepted,
  resolve,
  supersede,
  type SuggestionRow,
} from '../repositories/suggestion.repository.js';
import {
  mayHaveChanged,
  PROJECT_FIELDS,
  type ProjectField,
  type ProjectNow,
  isUpdateStale,
  type Upstream,
} from './project-rules.js';

/** What a refresh read of GitHub for imported projects: per project, the fields read just now. */
export type UpstreamByProject = Map<string, { repoId: number; fullName: string; values: Upstream }>;

/** An accept's outcome, decided in the transaction and turned into an answer after it. */
export type ProjectOutcome =
  | { kind: 'done'; applied: ResolveResponse['applied']; projectId: string }
  | { kind: 'stale' }
  | { kind: 'invalid' }
  | { kind: 'limit' };

const payloadOf = (row: SuggestionRow): Record<string, unknown> => row.payload ?? {};

/**
 * Repository-change suggestions (docs/modules/m7/plan.md §6.6e): what a refresh reads of
 * the student's imported repositories, and how an accept applies one. The rules
 * (what is offered, when it is stale) are in `project-rules.ts`.
 */
@Injectable()
export class ProjectSuggestionsService {
  private readonly schemas;

  constructor(
    private readonly dbs: DbService,
    private readonly imports: GithubImportService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    this.schemas = projectWriteSchemas({
      maxTags: cfg.PROJECT_MAX_TAGS,
      maxTechnologies: cfg.PROJECT_MAX_TECHNOLOGIES,
      maxLinks: cfg.PROJECT_MAX_LINKS,
      descriptionMaxBytes: cfg.PROJECT_DESCRIPTION_MAX_BYTES,
    });
  }

  /**
   * GitHub's description of each imported project whose repository is on the page just
   * read (no extra call: the list carries it), and its README for those pushed to since
   * their snapshot, at most SUGGESTIONS_README_READS of them, the newest pushed first.
   * Read outside any transaction; the rules decide afterwards, under the locks.
   */
  async readUpstream(
    github: GithubClient,
    token: GithubAccessToken,
    userId: string,
    page: readonly GithubRepo[],
  ): Promise<UpstreamByProject> {
    const byRepo = new Map(page.map((r) => [r.id, r]));
    const imported = await importedProjects(this.dbs.db, userId, [...byRepo.keys()]);
    const pushedAt = (repoId: number) => Date.parse(byRepo.get(repoId)?.pushedAt ?? '') || 0;
    const wantReadme = new Set(
      imported
        .filter((p) => mayHaveChanged(byRepo.get(p.repoId)?.pushedAt ?? null, p.syncedAt))
        .sort((a, b) => pushedAt(b.repoId) - pushedAt(a.repoId))
        .slice(0, this.cfg.SUGGESTIONS_README_READS)
        .map((p) => p.projectId),
    );
    const read = await mapLimit(imported, this.cfg.GITHUB_IMPORT_CONCURRENCY, async (p) => {
      const repo = byRepo.get(p.repoId)!;
      const readme = wantReadme.has(p.projectId)
        ? (await github.getReadme(token, p.repoId, this.cfg.GITHUB_README_MAX_BYTES)).readme
        : undefined;
      const described =
        readme === undefined
          ? undefined
          : descriptionOf(repo, readme, this.cfg.PROJECT_DESCRIPTION_MAX_BYTES);
      // The candidate goes through the create rules, like a re-sync's: the value
      // compared is the value that would be stored.
      const parsed = this.schemas.create.safeParse({
        ...fieldsOf(repo, described?.html ?? null),
        category: 'other',
        status: 'ongoing',
      });
      if (!parsed.success) return undefined;
      const values: Upstream = { summary: parsed.data.summary };
      // A README that is absent or too large is not a change to the description.
      if (described?.html !== undefined) {
        values.descriptionHtml = parsed.data.descriptionHtml;
      }
      return [p.projectId, { repoId: p.repoId, fullName: repo.fullName, values }] as const;
    });
    return new Map(read.filter((r) => r !== undefined));
  }

  /**
   * Accept of a `project.update`, inside the caller's transaction (the user lock is
   * held). The project is locked and read again: the field is written only when it
   * still equals the snapshot, and the snapshot is still the one the suggestion
   * was made against; anything else is `SUGGESTION_STALE`, never an overwrite.
   */
  async applyUpdateIn(
    trx: Transaction<DB>,
    user: UserRow,
    row: SuggestionRow,
  ): Promise<ProjectOutcome> {
    const stored = payloadOf(row);
    const projectId = row.targetId;
    const field = PROJECT_FIELDS.find((f) => f === stored.field);
    const value = stored.value;
    if (projectId === null || field === undefined || typeof value !== 'string') {
      await supersede(trx, user.id, [row.id]);
      return { kind: 'stale' };
    }
    const current = await lockOwnedProject(trx, user.id, projectId);
    const snapshot = current === undefined ? {} : ((await readSnapshot(trx, projectId)) ?? {});
    const now: ProjectNow | undefined =
      current === undefined
        ? undefined
        : {
            projectId,
            title: current.title,
            summary: current.summary,
            descriptionHtml: current.descriptionHtml,
            snapshot,
          };
    if (current === undefined || isUpdateStale(stored, now)) {
      await supersede(trx, user.id, [row.id]);
      return { kind: 'stale' };
    }
    const merged = this.schemas.create.safeParse({ ...current, [field]: value });
    if (!merged.success) {
      await supersede(trx, user.id, [row.id]);
      return { kind: 'invalid' };
    }
    if ((await updateOwnedProject(trx, user.id, projectId, merged.data)) === 0) {
      throw new NotFoundError('project');
    }
    await writeSnapshot(trx, projectId, {
      ...snapshot,
      [field]: hashField(field, merged.data[field]),
    });
    await resolve(trx, user.id, row.id, 'accepted');
    return { kind: 'done', applied: { field, value: null }, projectId };
  }

  /**
   * Accept of a `project.new`: imports the repository as a draft through the import
   * service (GitHub is read again; nothing the suggestion stored is trusted), then
   * answers the suggestion in its own transaction. Called with no transaction open.
   */
  async acceptNew(
    user: UserRow,
    identity: AccessTokenIdentity,
    row: SuggestionRow,
  ): Promise<ProjectOutcome> {
    const stored = payloadOf(row);
    const repoId = stored.repoId;
    if (typeof repoId !== 'number') {
      return inTransaction(this.dbs.db, async (trx) => {
        await supersede(trx, user.id, [row.id]);
        return { kind: 'stale' } as const;
      });
    }
    const { results } = await this.imports.import(user, identity, [repoId]);
    const result = results[0]!;
    return inTransaction(this.dbs.db, async (trx): Promise<ProjectOutcome> => {
      await lockUser(trx, user.id);
      const now = await lockSuggestion(trx, user.id, row.id);
      if (now === undefined) throw new NotFoundError('suggestion');
      if (now.status === 'accepted') {
        // A concurrent accept won: its answer stands.
        const projectId = payloadOf(now).projectId;
        return {
          kind: 'done',
          applied: { field: 'project', value: null },
          projectId: typeof projectId === 'string' ? projectId : (result.projectId ?? ''),
        };
      }
      if (result.outcome === 'created' && result.projectId !== null) {
        // The draft exists whatever happened to the suggestion meanwhile.
        await markAccepted(trx, user.id, row.id, {
          ...payloadOf(now),
          projectId: result.projectId,
        });
        return {
          kind: 'done',
          applied: { field: 'project', value: null },
          projectId: result.projectId,
        };
      }
      if (now.status !== 'open') {
        throw new ConflictError('SUGGESTION_RESOLVED', 'this suggestion is no longer open');
      }
      if (result.reason === 'LIMIT_REACHED') return { kind: 'limit' };
      await supersede(trx, user.id, [row.id]);
      return { kind: result.reason === 'invalid_repository' ? 'invalid' : 'stale' };
    });
  }

  /** What an accepted project suggestion reports on a retry. */
  appliedOf(row: SuggestionRow): ResolveResponse['applied'] {
    const p = payloadOf(row);
    if (row.kind === 'project.new') return { field: 'project', value: null };
    const field: ProjectField | undefined = PROJECT_FIELDS.find((f) => f === p.field);
    return field === undefined ? null : { field, value: null };
  }

  projectIdOf(row: SuggestionRow): string | null {
    if (row.kind === 'project.update') return row.targetId;
    const id = payloadOf(row).projectId;
    return typeof id === 'string' ? id : null;
  }
}
