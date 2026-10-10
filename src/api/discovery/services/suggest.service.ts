import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import type { Suggestions, SuggestionsQuery } from '../dto/discovery.dto.js';
import { suggestPeople, suggestProjects, suggestTags } from '../repositories/suggest.repository.js';

@Injectable()
export class SuggestService {
  constructor(
    private readonly dbs: DbService,
    private readonly files: FileUrlService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Three statements of at most SUGGEST_SIZE rows; a signed read URL per distinct avatar. */
  async suggest({ q }: SuggestionsQuery): Promise<Suggestions> {
    const { db } = this.dbs;
    const size = this.cfg.SUGGEST_SIZE;
    const [people, projects, tags] = await Promise.all([
      suggestPeople(db, q, size),
      suggestProjects(db, q, size),
      suggestTags(db, q, size),
    ]);
    // One signing per distinct stored URL: concurrent reads of the same one would each sign.
    const distinct = [
      ...new Set(people.map((p) => p.avatarUrl).filter((u): u is string => u !== null)),
    ];
    const signed = new Map(
      await Promise.all(distinct.map(async (u) => [u, await this.files.read(u)] as const)),
    );
    return {
      query: q,
      people: people.map((p) => ({
        id: p.id,
        label: p.name,
        avatarUrl: p.avatarUrl === null ? null : (signed.get(p.avatarUrl) ?? p.avatarUrl),
      })),
      projects: projects.map((p) => ({ id: p.id, label: p.title, avatarUrl: null })),
      tags: tags.map((t) => t.name),
    };
  }
}
