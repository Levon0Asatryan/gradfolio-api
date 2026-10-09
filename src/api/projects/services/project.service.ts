import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import { findVisibleUser } from '../../profiles/repositories/profile.repository.js';
import type { ProjectDetail, ProjectListQuery, ProjectPage } from '../dto/project.dto.js';
import {
  findVisibleProject,
  listAcceptedTeam,
  listAttachments,
  listProjectRows,
  type ListScope,
} from '../repositories/project.repository.js';
import { termsOf } from '../repositories/project-terms.repository.js';
import { decodeCursor, encodeCursor, SORTS } from '../utils/cursor.js';
import { toDetail, toSummary } from '../utils/project-mapping.js';

@Injectable()
export class ProjectService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly files: FileUrlService,
  ) {}

  /**
   * A project as `viewerId` (undefined: anonymous) may see it. One a viewer may
   * not read is "not found", the same answer as for an id that does not exist;
   * its children are only read after the row itself was.
   */
  async getProject(id: string, viewerId: string | undefined): Promise<ProjectDetail> {
    const { db } = this.dbs;
    const row = await findVisibleProject(db, id, viewerId);
    if (row === undefined) throw new NotFoundError('project');
    const [attachments, team, tags, technologies] = await Promise.all([
      listAttachments(db, row.id),
      listAcceptedTeam(db, row.id, viewerId),
      termsOf(db, 'projectTags', [row.id]),
      termsOf(db, 'projectTechnologies', [row.id]),
    ]);
    const detail = toDetail(
      row,
      {
        attachments,
        team,
        tags: tags.get(row.id) ?? [],
        technologies: technologies.get(row.id) ?? [],
      },
      viewerId,
      this.cfg.ATTACHMENT_VIDEO_HOSTS,
    );
    return this.signDetail(detail);
  }

  /** Stored file URLs become short-lived signed read URLs (plan §2.2); external ones pass through. */
  private async signDetail(d: ProjectDetail): Promise<ProjectDetail> {
    // Team rows are not signed: no write path registers a file for them yet (M5 must).
    const [heroImageUrl, ownerAvatar, attachments] = await Promise.all([
      this.files.read(d.heroImageUrl),
      this.files.read(d.owner.avatarUrl),
      Promise.all(
        d.attachments.map(async (a) => ({
          ...a,
          url: await this.files.read(a.url),
          thumbnailUrl: await this.files.read(a.thumbnailUrl),
        })),
      ),
      Promise.all(
        d.team.map(async (m) => ({ ...m, avatarUrl: await this.files.read(m.avatarUrl) })),
      ),
    ]);
    return { ...d, heroImageUrl, owner: { ...d.owner, avatarUrl: ownerAvatar }, attachments };
  }

  /** The caller's own projects, every state. */
  listMine(userId: string, query: ProjectListQuery): Promise<ProjectPage> {
    return this.page({ ownerId: userId, publishedOnly: false }, query, userId);
  }

  /**
   * A user's public, published projects. A user whose profile the viewer may
   * not read is "not found" (Q3), so a private profile does not list its work.
   * Even the owner sees only the published ones here; `listMine` is theirs.
   */
  async listOfUser(
    userId: string,
    viewerId: string | undefined,
    query: ProjectListQuery,
  ): Promise<ProjectPage> {
    const user = await findVisibleUser(this.dbs.db, userId, viewerId);
    if (user === undefined) throw new NotFoundError('profile');
    return this.page({ ownerId: user.id, publishedOnly: true }, query, viewerId);
  }

  private async page(
    scope: ListScope,
    query: ProjectListQuery,
    viewerId: string | undefined,
  ): Promise<ProjectPage> {
    const limit = query.limit ?? this.cfg.PROJECTS_PAGE_SIZE;
    if (limit > this.cfg.PROJECTS_PAGE_MAX) {
      throw new ValidationError([
        { path: 'limit', message: `must be at most ${this.cfg.PROJECTS_PAGE_MAX}` },
      ]);
    }
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor, query.sort);
    if (query.cursor !== undefined && cursor === undefined) {
      throw new ValidationError([{ path: 'cursor', message: 'is not a cursor for this sort' }]);
    }

    const { db } = this.dbs;
    const rows = await listProjectRows(db, scope, query, query.sort, cursor, limit);
    const shown = rows.slice(0, limit);
    const ids = shown.map((r) => r.id);
    const [tags, technologies] = await Promise.all([
      termsOf(db, 'projectTags', ids),
      termsOf(db, 'projectTechnologies', ids),
    ]);

    const last = shown.at(-1);
    const spec = SORTS[query.sort];
    const items = await Promise.all(
      shown.map(async (r) => {
        const summary = toSummary(
          r,
          { tags: tags.get(r.id) ?? [], technologies: technologies.get(r.id) ?? [] },
          viewerId,
        );
        return { ...summary, heroImageUrl: await this.files.read(summary.heroImageUrl) };
      }),
    );
    return {
      items,
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(query.sort, {
              v:
                spec.kind === 'date'
                  ? last[spec.column as 'createdAt' | 'updatedAt'].getTime()
                  : last.title,
              id: last.id,
            })
          : null,
    };
  }
}
