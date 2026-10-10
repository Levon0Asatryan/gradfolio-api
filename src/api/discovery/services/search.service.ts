import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { ValidationError } from '../../../core/errors/app-error.js';
import type {
  DiscoveryProjectPage,
  PersonPage,
  SearchPageQuery,
  SearchQuery,
  SearchResults,
} from '../dto/discovery.dto.js';
import { findPeople, findProjects } from '../repositories/search.repository.js';
import { decodeCursor, encodeCursor } from '../utils/discovery-cursor.js';
import { CardsService } from './cards.service.js';

const PEOPLE_SCOPE = 'search-people';
const PROJECTS_SCOPE = 'search-projects';

@Injectable()
export class SearchService {
  constructor(
    private readonly dbs: DbService,
    private readonly cards: CardsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Both groups, the best few of each, no cursor: the search page's first screen. */
  async grouped({ q }: SearchQuery): Promise<SearchResults> {
    const { db } = this.dbs;
    const size = this.cfg.SEARCH_GROUP_SIZE;
    const [people, projects] = await Promise.all([
      findPeople(db, q, undefined, size),
      findProjects(db, q, undefined, size),
    ]);
    const [peopleItems, projectItems] = await Promise.all([
      this.cards.people(people.slice(0, size)),
      this.cards.projects(projects.slice(0, size)),
    ]);
    return {
      query: q.text,
      people: { items: peopleItems, hasMore: people.length > size },
      projects: { items: projectItems, hasMore: projects.length > size },
    };
  }

  async people({ q, limit, cursor }: SearchPageQuery): Promise<PersonPage> {
    const size = this.pageSize(limit);
    const after = this.cursor(cursor, PEOPLE_SCOPE);
    const rows = await findPeople(this.dbs.db, q, after, size);
    const shown = rows.slice(0, size);
    const last = shown.at(-1);
    return {
      items: await this.cards.people(shown),
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCursor(PEOPLE_SCOPE, {
              r: Number(last.relevance),
              t: last.createdAt.getTime(),
              id: last.id,
            })
          : null,
    };
  }

  async projects({ q, limit, cursor }: SearchPageQuery): Promise<DiscoveryProjectPage> {
    const size = this.pageSize(limit);
    const after = this.cursor(cursor, PROJECTS_SCOPE);
    const rows = await findProjects(this.dbs.db, q, after, size);
    const shown = rows.slice(0, size);
    const last = shown.at(-1);
    return {
      items: await this.cards.projects(shown),
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCursor(PROJECTS_SCOPE, {
              r: Number(last.relevance),
              t: last.createdAt.getTime(),
              id: last.id,
            })
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
    const decoded = decodeCursor(raw, scope, true);
    if (decoded === undefined) {
      throw new ValidationError([{ path: 'cursor', message: 'is not a cursor for this list' }]);
    }
    return decoded;
  }
}
