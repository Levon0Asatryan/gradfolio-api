import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { decodeTimeCursor, encodeTimeCursor } from '../../common/utils/time-cursor.js';
import {
  type Notification,
  type NotificationPage,
  type NotificationQuery,
  NOTIFICATION_TYPES,
} from '../dto/notification.dto.js';
import {
  countUnread,
  listNotificationRows,
  markAllRead,
  markRead,
  membershipStatuses,
  type NotificationRow,
  readableProjectIds,
  visibleUserIds,
} from '../repositories/notification.repository.js';

const KNOWN = new Set<string>(NOTIFICATION_TYPES);

@Injectable()
export class NotificationService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async list(userId: string, query: NotificationQuery): Promise<NotificationPage> {
    const limit = query.limit ?? this.cfg.NOTIFICATIONS_PAGE_SIZE;
    if (limit > this.cfg.NOTIFICATIONS_PAGE_MAX) {
      throw new ValidationError([
        { path: 'limit', message: `must be at most ${this.cfg.NOTIFICATIONS_PAGE_MAX}` },
      ]);
    }
    const cursor = query.cursor === undefined ? undefined : decodeTimeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === undefined) {
      throw new ValidationError([{ path: 'cursor', message: 'is not a cursor' }]);
    }

    const { db } = this.dbs;
    const rows = await listNotificationRows(db, userId, cursor, limit);
    const shown = rows.slice(0, limit);

    // What each row points at is read now, for this reader: the link and the
    // invitation's state are never stored (S12).
    const projectIds = [
      ...new Set(shown.map((r) => projectIdOf(r)).filter((id): id is string => id !== null)),
    ];
    const actorIds = [
      ...new Set(
        shown
          .map((r) => r.params?.actorId)
          .filter((id): id is string => id !== undefined && id !== null && id !== ''),
      ),
    ];
    const [readable, statuses, visibleActors] = await Promise.all([
      readableProjectIds(db, userId, projectIds),
      membershipStatuses(db, userId, projectIds),
      visibleUserIds(db, userId, actorIds),
    ]);

    const items = shown.map((r): Notification => {
      const projectId = projectIdOf(r);
      const type = KNOWN.has(r.type) ? (r.type as Notification['type']) : 'general';
      return {
        id: r.id,
        type,
        title: r.title,
        params:
          r.params === null
            ? null
            : {
                actorId:
                  r.params.actorId != null && visibleActors.has(r.params.actorId)
                    ? r.params.actorId
                    : null,
                actorName: r.params.actorName,
                projectId: r.params.projectId,
                projectTitle: r.params.projectTitle,
                role: r.params.role ?? null,
              },
        read: r.isRead,
        createdAt: r.createdAt.toISOString(),
        link: projectId !== null && readable.has(projectId) ? `/projects/${projectId}` : null,
        invite:
          type === 'team_invite'
            ? { status: (projectId === null ? undefined : statuses.get(projectId)) ?? 'gone' }
            : null,
      };
    });

    const last = shown.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeTimeCursor({ t: last.createdAt.getTime(), id: last.id })
          : null,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return countUnread(this.dbs.db, userId);
  }

  /** 404 when the notification is not the caller's (or does not exist): the same answer. */
  async markRead(userId: string, id: string): Promise<void> {
    if ((await markRead(this.dbs.db, userId, id)) === 0) throw new NotFoundError('notification');
  }

  markAllRead(userId: string): Promise<number> {
    return markAllRead(this.dbs.db, userId);
  }
}

/** The project a notification is about: `reference_id` when it names a project. */
function projectIdOf(r: NotificationRow): string | null {
  return r.referenceType === 'project' ? r.referenceId : null;
}
