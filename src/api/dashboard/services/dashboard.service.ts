import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { listActivityRows } from '../../activities/repositories/activity.repository.js';
import { toActivity } from '../../activities/utils/activity-mapping.js';
import { listProjectRows } from '../../projects/repositories/project.repository.js';
import { termsOf } from '../../projects/repositories/project-terms.repository.js';
import type { Dashboard } from '../dto/dashboard.dto.js';
import { projectStats, recentActivityCount } from '../repositories/dashboard.repository.js';

const DAY_MS = 86_400_000;

@Injectable()
export class DashboardService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * The caller's dashboard in a fixed number of statements: counts, recent
   * projects (+ their technologies), the activity count and the feed. Nothing
   * here takes an id from the request: every statement is scoped to the caller
   * the token resolved to, so there is no one else's data to reach.
   */
  async get(userId: string): Promise<Dashboard> {
    const { db } = this.dbs;
    const since = new Date(Date.now() - this.cfg.DASHBOARD_ACTIVITY_DAYS * DAY_MS);
    const recent = this.cfg.DASHBOARD_RECENT_PROJECTS;
    const [stats, projectRows, recentActivities, feed] = await Promise.all([
      projectStats(db, userId),
      // The same read as the caller's profile and `/me/projects`: own projects plus
      // non-draft ones they are an accepted member of, newest change first.
      listProjectRows(
        db,
        { ownerId: userId, publishedOnly: false },
        { sort: 'updated' },
        'updated',
        undefined,
        recent,
      ),
      recentActivityCount(db, userId, since),
      listActivityRows(db, userId, undefined, this.cfg.DASHBOARD_FEED_SIZE),
    ]);
    const shown = projectRows.slice(0, recent);
    const technologies = await termsOf(
      db,
      'projectTechnologies',
      shown.map((r) => r.id),
    );
    return {
      stats: {
        projects: {
          total: stats.total,
          published: stats.published,
          private: stats.private,
          draft: stats.draft,
        },
        githubStars: stats.githubStars,
        recentActivities,
      },
      recentProjects: shown.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        category: r.category,
        status: r.status,
        technologies: technologies.get(r.id) ?? [],
        role: r.userId === userId ? ('owner' as const) : ('member' as const),
        isPublic: r.isPublic,
        isDraft: r.isDraft,
        updatedAt: r.updatedAt.toISOString(),
      })),
      activities: feed.slice(0, this.cfg.DASHBOARD_FEED_SIZE).map(toActivity),
    };
  }
}
