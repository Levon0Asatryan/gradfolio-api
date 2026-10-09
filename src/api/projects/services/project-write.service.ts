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
  deleteOwnedProjectIn,
  insertProject,
  lockOwnedProject,
  lockProjectFileUrls,
  updateOwnedProject,
} from '../repositories/project-write.repository.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import { ProjectService } from './project.service.js';

@Injectable()
export class ProjectWriteService {
  private readonly schemas;

  constructor(
    private readonly dbs: DbService,
    private readonly reads: ProjectService,
    private readonly files: FileUrlService,
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
    const register = this.registerOnce(userId);
    await inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      if ((await countOwnedProjects(trx, userId)) >= this.cfg.PROJECT_MAX_PER_USER) {
        throw new ConflictError(
          'LIMIT_REACHED',
          `at most ${this.cfg.PROJECT_MAX_PER_USER} projects are allowed`,
        );
      }
      // Registering a file is network I/O, under the user lock for a moment: fine at
      // this scale, and a failure here writes nothing.
      const heroImageUrl =
        input.heroImageUrl === null ? null : await register(input.heroImageUrl, 'hero');
      await insertProject(trx, userId, id, { ...input, heroImageUrl });
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
    const register = this.registerOnce(userId);
    const released = await inTransaction(this.dbs.db, async (trx) => {
      const stored = await lockOwnedProject(trx, userId, id);
      if (stored === undefined) throw new NotFoundError('project');
      const merged = parse(this.schemas.create, merge(stored, patch));
      const heroImageUrl = await this.resolveHero(
        register,
        stored.heroImageUrl,
        merged.heroImageUrl,
      );
      // The pool counts matched rows, so a patch that changes nothing is 1.
      if ((await updateOwnedProject(trx, userId, id, { ...merged, heroImageUrl })) === 0) {
        throw new NotFoundError('project');
      }
      if (patch.technologies !== undefined) {
        await setProjectTerms(trx, id, 'technologies', merged.technologies);
      }
      if (patch.tags !== undefined) await setProjectTerms(trx, id, 'tags', merged.tags);
      return this.files
        .keysOf([stored.heroImageUrl])
        .filter((k) => !this.files.keysOf([heroImageUrl]).includes(k));
    });
    await this.files.release(released);
    return this.reads.getProject(id, userId);
  }

  /** Children cascade. The objects they pointed at are deleted after the commit. */
  async remove(userId: string, id: string): Promise<void> {
    const keys = await inTransaction(this.dbs.db, async (trx) => {
      const urls = await lockProjectFileUrls(trx, userId, id);
      if (urls === undefined) throw new NotFoundError('project');
      if ((await deleteOwnedProjectIn(trx, userId, id)) === 0) throw new NotFoundError('project');
      return this.files.keysOf(urls);
    });
    await this.files.release(keys);
  }

  /**
   * `accept` for one request, remembered per URL: `inTransaction` reruns the
   * whole body after a deadlock, and a file claimed by the first attempt must
   * not be rejected as "already in use" by the second.
   */
  private registerOnce(userId: string) {
    const done = new Map<string, Promise<string>>();
    return (url: string, kind: Parameters<FileUrlService['accept']>[2]): Promise<string> => {
      const hit = done.get(url);
      if (hit !== undefined) return hit;
      const pending = this.files.accept(userId, url, kind);
      done.set(url, pending);
      return pending;
    };
  }

  /**
   * The hero image to store: the stored value when the request names the same
   * object (a client may send back the signed form), else the newly registered
   * one, else as given.
   */
  private async resolveHero(
    register: ReturnType<ProjectWriteService['registerOnce']>,
    stored: string | null,
    requested: string | null,
  ): Promise<string | null> {
    if (requested === null) return null;
    const key = this.files.keyOf(requested);
    if (key !== null && key === this.files.keyOf(stored)) return stored;
    if (requested === stored) return stored;
    return register(requested, 'hero');
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
