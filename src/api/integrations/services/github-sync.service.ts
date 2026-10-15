import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { setProjectTerms } from '../../../core/db/terms.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { GithubNotLinkedError } from '../../../core/github/errors.js';
import { projectWriteSchemas } from '../../projects/dto/project-write.dto.js';
import {
  lockOwnedProject,
  updateOwnedProject,
  updateRepoFacts,
} from '../../projects/repositories/project-write.repository.js';
import type { UserRow } from '../../users/repositories/user.repository.js';
import {
  githubProjectMeta,
  readSnapshot,
  writeSnapshot,
} from '../repositories/github-import.repository.js';
import {
  descriptionOf,
  fieldsOf,
  hashField,
  SYNCED_FIELDS,
  type SyncedField,
} from '../utils/github-fields.js';
import { GithubConnectionService } from './github-connection.service.js';

type Outcome = 'unchanged' | 'updated' | 'kept' | 'conflict';
interface FieldReport {
  field: SyncedField;
  outcome: Outcome;
  githubValue?: string | string[] | null;
}
type Value = string | string[] | null;

/**
 * Re-sync of one imported project (docs/m7-plan.md §3.5). A field is compared
 * three ways, by hash: the project's value now, the value the last import or
 * re-sync wrote (the snapshot), and what GitHub says now. Only a field still as
 * written is updated; the comparison is made under the project's row lock, so
 * an edit committed while GitHub was being asked is seen as an edit.
 */
@Injectable()
export class GithubSyncService {
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

  async sync(user: UserRow, identity: AccessTokenIdentity, projectId: string, dryRun: boolean) {
    const meta = await githubProjectMeta(this.dbs.db, user.id, projectId);
    if (meta === undefined) throw new NotFoundError('project');
    if (meta.source !== 'github' || meta.githubRepoId === null) {
      throw new ConflictError('NOT_GITHUB_PROJECT', 'this project was not imported from GitHub');
    }

    const { gh, token } = await this.connection.requireConnected(user, identity);
    const call = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof GithubNotLinkedError) gh.tokens.forget(user.auth0Id);
        throw err;
      }
    };

    // GitHub is asked before the lock is taken.
    const { repo } = await call(() => gh.github.getRepo(token, meta.githubRepoId!));
    if (repo === null) {
      throw new ConflictError(
        'GITHUB_REPO_UNAVAILABLE',
        'the repository no longer exists or is no longer visible to this GitHub account',
      );
    }
    const readme = await call(() =>
      gh.github.getReadme(token, meta.githubRepoId!, this.cfg.GITHUB_README_MAX_BYTES),
    );
    const description = descriptionOf(repo, readme, this.cfg.PROJECT_DESCRIPTION_MAX_BYTES);
    // The candidate goes through the same schema as a manual write, so the
    // values compared are the values that would be stored.
    const parsed = this.schemas.create.safeParse({
      ...fieldsOf(repo, description.html ?? null),
      category: 'other',
      status: 'ongoing',
    });
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      );
    }
    const github = parsed.data;
    const githubValues: Record<SyncedField, Value> = {
      title: github.title,
      summary: github.summary,
      descriptionHtml: github.descriptionHtml,
      repoUrl: github.repoUrl,
      technologies: github.technologies,
    };
    // A README left out (too large) is not a change to the description.
    const skipDescription = description.html === undefined;
    const facts = {
      stars: repo.stars,
      forks: repo.forks,
      language: repo.language,
      readmeUrl: `${repo.htmlUrl}#readme`,
    };

    return inTransaction(this.dbs.db, async (trx) => {
      const current = await lockOwnedProject(trx, user.id, projectId);
      if (current === undefined) throw new NotFoundError('project');
      const snapshot = (await readSnapshot(trx, projectId)) ?? {};
      const stored: Record<SyncedField, Value> = {
        title: current.title,
        summary: current.summary,
        descriptionHtml: current.descriptionHtml,
        repoUrl: current.repoUrl,
        technologies: current.technologies,
      };

      const fields: FieldReport[] = [];
      const next: Record<string, Value> = {};
      const nextSnapshot: Record<string, string> = { ...snapshot };
      for (const field of SYNCED_FIELDS) {
        const theirs = githubValues[field];
        if (field === 'descriptionHtml' && skipDescription) {
          fields.push({ field, outcome: 'unchanged' });
          continue;
        }
        const wrote = snapshot[field];
        const edited = hashField(field, stored[field]) !== wrote;
        const changedAtGithub = hashField(field, theirs) !== wrote;
        if (!edited && !changedAtGithub) {
          fields.push({ field, outcome: 'unchanged' });
        } else if (!edited) {
          fields.push({ field, outcome: 'updated' });
          next[field] = theirs;
          nextSnapshot[field] = hashField(field, theirs);
        } else if (!changedAtGithub) {
          fields.push({ field, outcome: 'kept' });
        } else {
          // Both changed. The caller's value stands; GitHub's is reported, and
          // the snapshot is left, so the next sync reports it again.
          fields.push({ field, outcome: 'conflict', githubValue: theirs });
        }
      }

      const meta2 = await githubProjectMeta(trx, user.id, projectId);
      const systemUpdated: {
        field: 'stars' | 'forks' | 'language' | 'readmeUrl';
        value: string | number | null;
      }[] = [];
      if (meta2?.repoStars !== facts.stars)
        systemUpdated.push({ field: 'stars', value: facts.stars });
      if (meta2?.repoForks !== facts.forks)
        systemUpdated.push({ field: 'forks', value: facts.forks });
      if (meta2?.repoLanguage !== facts.language) {
        systemUpdated.push({ field: 'language', value: facts.language });
      }
      if (meta2?.repoReadmeUrl !== facts.readmeUrl) {
        systemUpdated.push({ field: 'readmeUrl', value: facts.readmeUrl });
      }

      if (!dryRun) {
        const keys = Object.keys(next);
        if (keys.length > 0) {
          const merged = this.schemas.create.parse({ ...current, ...next });
          if ((await updateOwnedProject(trx, user.id, projectId, merged)) === 0) {
            throw new NotFoundError('project');
          }
          if ('technologies' in next) {
            await setProjectTerms(trx, projectId, 'technologies', merged.technologies);
          }
        }
        await updateRepoFacts(trx, user.id, projectId, facts);
        await writeSnapshot(trx, projectId, nextSnapshot);
      }
      return { dryRun, fields, systemUpdated };
    });
  }
}
