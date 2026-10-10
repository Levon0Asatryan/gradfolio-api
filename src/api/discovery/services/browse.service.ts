import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { ValidationError } from '../../../core/errors/app-error.js';
import type {
  BrowseProjectsQuery,
  BrowseUsersQuery,
  DiscoveryProjectPage,
  PersonPage,
  TagCloud,
  TagCloudQuery,
  UserFacets,
} from '../dto/discovery.dto.js';
import {
  browseProjects,
  browseUsers,
  tagCloud,
  userFacets,
} from '../repositories/browse.repository.js';
import { decodeCursor, encodeCursor } from '../utils/discovery-cursor.js';
import { SingleFlightCache } from '../utils/single-flight-cache.js';
import { CardsService } from './cards.service.js';

type Cloud = TagCloud;
type Facets = UserFacets;

@Injectable()
export class BrowseService {
  private readonly cloud: SingleFlightCache<Cloud>;
  private readonly facets: SingleFlightCache<Facets>;

  constructor(
    private readonly dbs: DbService,
    private readonly cards: CardsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    const ttl = cfg.DISCOVERY_CACHE_S * 1000;
    // The cloud is computed for the largest size once; callers slice it.
    this.cloud = new SingleFlightCache(ttl, async () => ({
      items: await tagCloud(this.dbs.db, this.cfg.TAG_CLOUD_MAX),
      generatedAt: new Date().toISOString(),
    }));
    this.facets = new SingleFlightCache(ttl, async () => ({
      ...(await userFacets(this.dbs.db, this.cfg.FACET_MAX)),
      generatedAt: new Date().toISOString(),
    }));
  }

  async projects(q: BrowseProjectsQuery): Promise<DiscoveryProjectPage> {
    const size = this.pageSize(q.limit);
    const scope = `browse-projects:${q.sort}`;
    const after = this.cursor(q.cursor, scope);
    const rows = await browseProjects(this.dbs.db, q, after, size);
    const shown = rows.slice(0, size);
    const last = shown.at(-1);
    const time = (r: (typeof shown)[number]) =>
      (q.sort === 'updated' ? r.updatedAt : r.createdAt).getTime();
    return {
      items: await this.cards.projects(shown),
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCursor(scope, { t: time(last), id: last.id })
          : null,
    };
  }

  async users(q: BrowseUsersQuery): Promise<PersonPage> {
    const size = this.pageSize(q.limit);
    const scope = 'browse-users';
    const after = this.cursor(q.cursor, scope);
    const rows = await browseUsers(this.dbs.db, q, after, size);
    const shown = rows.slice(0, size);
    const last = shown.at(-1);
    return {
      items: await this.cards.people(shown),
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCursor(scope, { t: last.createdAt.getTime(), id: last.id })
          : null,
    };
  }

  async userFacets(): Promise<UserFacets> {
    return this.facets.get();
  }

  async tagCloud({ limit }: TagCloudQuery): Promise<TagCloud> {
    const size = limit ?? this.cfg.TAG_CLOUD_SIZE;
    if (size > this.cfg.TAG_CLOUD_MAX) {
      throw new ValidationError([
        { path: 'limit', message: `must be at most ${this.cfg.TAG_CLOUD_MAX}` },
      ]);
    }
    const cloud = await this.cloud.get();
    return { items: cloud.items.slice(0, size), generatedAt: cloud.generatedAt };
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
