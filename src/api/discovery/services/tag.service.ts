import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import type {
  DiscoveryProjectPage,
  PersonPage,
  TagPageQuery,
  TagQuery,
  TagSummary,
} from '../dto/discovery.dto.js';
import {
  canonicalTerm,
  peopleWithTerm,
  projectsWithTerm,
  tagCounts,
} from '../repositories/tag.repository.js';
import { decodeCursor, encodeCursor } from '../utils/discovery-cursor.js';
import { CardsService } from './cards.service.js';

const PROJECTS_SCOPE = 'tag-projects';
const PEOPLE_SCOPE = 'tag-people';

@Injectable()
export class TagService {
  constructor(
    private readonly dbs: DbService,
    private readonly cards: CardsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * A term and how many discoverable things use it. A term nothing public uses
   * answers 404, exactly as one nobody ever wrote does, so the answer says
   * nothing about private work.
   */
  async summary({ name }: TagQuery): Promise<TagSummary> {
    const { db } = this.dbs;
    const [counts, canonical] = await Promise.all([tagCounts(db, name), canonicalTerm(db, name)]);
    if (counts.projectCount === 0 && counts.peopleCount === 0) throw new NotFoundError('tag');
    return { name: canonical ?? name, ...counts };
  }

  async projects({ name, limit, cursor }: TagPageQuery): Promise<DiscoveryProjectPage> {
    const size = this.pageSize(limit);
    const after = this.cursor(cursor, PROJECTS_SCOPE);
    const rows = await projectsWithTerm(this.dbs.db, name, after, size);
    const shown = rows.slice(0, size);
    const last = shown.at(-1);
    return {
      items: await this.cards.projects(shown),
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCursor(PROJECTS_SCOPE, { t: last.createdAt.getTime(), id: last.id })
          : null,
    };
  }

  async people({ name, limit, cursor }: TagPageQuery): Promise<PersonPage> {
    const size = this.pageSize(limit);
    const after = this.cursor(cursor, PEOPLE_SCOPE);
    const rows = await peopleWithTerm(this.dbs.db, name, after, size);
    const shown = rows.slice(0, size);
    const last = shown.at(-1);
    return {
      items: await this.cards.people(shown),
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCursor(PEOPLE_SCOPE, { t: last.createdAt.getTime(), id: last.id })
          : null,
    };
  }

  private pageSize(limit: number | undefined): number {
    const size = limit ?? this.cfg.DISCOVERY_PAGE_SIZE;
    if (size > this.cfg.DISCOVERY_PAGE_MAX) {
      throw new ValidationError([
        { path: 'limit', message: `must be at most ${this.cfg.DISCOVERY_PAGE_MAX}` },
      ]);
    }
    return size;
  }

  private cursor(raw: string | undefined, scope: string) {
    if (raw === undefined) return undefined;
    const decoded = decodeCursor(raw, scope, false);
    if (decoded === undefined) {
      throw new ValidationError([{ path: 'cursor', message: 'is not a cursor for this list' }]);
    }
    return decoded;
  }
}
