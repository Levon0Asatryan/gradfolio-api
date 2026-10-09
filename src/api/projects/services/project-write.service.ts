import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { newId } from '../../../core/db/ids.js';
import { setProjectTerms } from '../../../core/db/terms.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { lockUser } from '../../../core/db/user-lock.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import {
  type PatchProject,
  type ProjectInput,
  projectWriteSchemas,
} from '../dto/project-write.dto.js';
import type { ProjectDetail } from '../dto/project.dto.js';
import {
  countOwnedProjects,
  deleteOwnedProject,
  insertProject,
  lockOwnedProject,
  updateOwnedProject,
} from '../repositories/project-write.repository.js';
import { ProjectService } from './project.service.js';

@Injectable()
export class ProjectWriteService {
  private readonly schemas;

  constructor(
    private readonly dbs: DbService,
    private readonly reads: ProjectService,
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
   * A new project. Under the user lock the count and the insert cannot be
   * raced: two creates at cap - 1 give one 201 and one 409. Validation runs
   * first, so a bad body never takes the lock.
   */
  async create(userId: string, body: unknown): Promise<ProjectDetail> {
    const input = parse(this.schemas.create, body);
    const id = newId();
    await inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      if ((await countOwnedProjects(trx, userId)) >= this.cfg.PROJECT_MAX_PER_USER) {
        throw new ConflictError(
          'LIMIT_REACHED',
          `at most ${this.cfg.PROJECT_MAX_PER_USER} projects are allowed`,
        );
      }
      await insertProject(trx, userId, id, input);
      await setProjectTerms(trx, id, 'technologies', input.technologies);
      await setProjectTerms(trx, id, 'tags', input.tags);
    });
    return this.reads.getProject(id, userId);
  }

  /**
   * Partial update. The stored project is read `FOR UPDATE`, scoped to the
   * caller (someone else's id is "not found"), the patch merged over it and the
   * *whole* result validated, so cross-field rules hold and two concurrent
   * patches of one project cannot each break the rule the other kept. The row
   * lock also serializes the tags/technologies replace-all.
   */
  async update(userId: string, id: string, body: unknown): Promise<ProjectDetail> {
    const patch = parse(this.schemas.patch, body);
    await inTransaction(this.dbs.db, async (trx) => {
      const stored = await lockOwnedProject(trx, userId, id);
      if (stored === undefined) throw new NotFoundError('project');
      const merged = parse(this.schemas.create, merge(stored, patch));
      // The pool counts matched rows, so a patch that changes nothing is 1.
      if ((await updateOwnedProject(trx, userId, id, merged)) === 0) {
        throw new NotFoundError('project');
      }
      if (patch.technologies !== undefined) {
        await setProjectTerms(trx, id, 'technologies', merged.technologies);
      }
      if (patch.tags !== undefined) await setProjectTerms(trx, id, 'tags', merged.tags);
    });
    return this.reads.getProject(id, userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    if ((await deleteOwnedProject(this.dbs.db, userId, id)) === 0) {
      throw new NotFoundError('project');
    }
  }
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
    );
  }
  return parsed.data;
}

/** The stored project with the patch's named fields replaced; `metadata` merges per key. */
function merge(
  stored: Omit<ProjectInput, 'descriptionHtml'> & { descriptionHtml: string | null },
  patch: PatchProject,
): Record<string, unknown> {
  const { metadata, ...rest } = patch;
  const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  const definedMeta = Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([, v]) => v !== undefined),
  );
  return { ...stored, ...defined, metadata: { ...stored.metadata, ...definedMeta } };
}
