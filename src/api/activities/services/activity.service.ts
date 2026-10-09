import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { ValidationError } from '../../../core/errors/app-error.js';
import { decodeTimeCursor, encodeTimeCursor } from '../../common/utils/time-cursor.js';
import type { ActivityPage, ActivityQuery } from '../dto/activity.dto.js';
import { listActivityRows } from '../repositories/activity.repository.js';

@Injectable()
export class ActivityService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * The caller's own feed. There is no feed of anyone else's in v1 and no
   * activity id to ask for, so there is nothing for a second user to reach;
   * a public feed would have to filter by what the viewer may read (the
   * parameters carry `projectId` for that).
   */
  async list(userId: string, query: ActivityQuery): Promise<ActivityPage> {
    const limit = query.limit ?? this.cfg.ACTIVITIES_PAGE_SIZE;
    if (limit > this.cfg.ACTIVITIES_PAGE_MAX) {
      throw new ValidationError([
        { path: 'limit', message: `must be at most ${this.cfg.ACTIVITIES_PAGE_MAX}` },
      ]);
    }
    const cursor = query.cursor === undefined ? undefined : decodeTimeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === undefined) {
      throw new ValidationError([{ path: 'cursor', message: 'is not a cursor' }]);
    }
    const rows = await listActivityRows(this.dbs.db, userId, cursor, limit);
    const shown = rows.slice(0, limit);
    const last = shown.at(-1);
    return {
      items: shown.map((r) => ({
        id: r.id,
        type: r.type,
        translationKey: r.translationKey,
        translationParams: r.translationParams,
        timestamp: r.timestamp.toISOString(),
      })),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeTimeCursor({ t: last.timestamp.getTime(), id: last.id })
          : null,
    };
  }
}
