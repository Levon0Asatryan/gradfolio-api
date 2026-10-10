import { z } from 'zod';
import { activitySchema } from '../../activities/dto/activity.dto.js';
import { PROJECT_CATEGORIES, PROJECT_STATUSES } from '../../projects/dto/project.dto.js';

export const dashboardProjectSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    summary: z.string().nullable().meta({ description: 'The author’s own text. Plain text.' }),
    category: z.enum(PROJECT_CATEGORIES),
    status: z.enum(PROJECT_STATUSES),
    technologies: z.array(z.string()),
    role: z.enum(['owner', 'member']).meta({
      description:
        'owner: the caller created it; member: the caller is an accepted team member (never a draft).',
    }),
    isPublic: z.boolean(),
    isDraft: z.boolean(),
    updatedAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
  })
  .meta({ id: 'DashboardProject' });

export const dashboardStatsSchema = z
  .object({
    projects: z
      .object({
        total: z.number().int(),
        published: z.number().int().meta({ description: 'Public and not a draft.' }),
        private: z.number().int().meta({ description: 'Not public and not a draft.' }),
        draft: z.number().int(),
      })
      .meta({
        id: 'DashboardProjectCounts',
        description:
          'The caller’s own projects, by state (team projects of others are not counted).',
      }),
    githubStars: z.number().int().nullable().meta({
      description:
        'Sum of the stars stored on the caller’s non-draft projects; null until an import has stored any (M7).',
    }),
    recentActivities: z.number().int().meta({
      description: 'Entries in the caller’s feed from the last DASHBOARD_ACTIVITY_DAYS (30) days.',
    }),
  })
  .meta({ id: 'DashboardStats' });

export const dashboardSchema = z
  .object({
    stats: dashboardStatsSchema,
    recentProjects: z.array(dashboardProjectSchema).meta({
      description:
        'The caller’s most recently changed projects: their own, and non-draft ones they are an accepted member of.',
    }),
    activities: z.array(activitySchema).meta({
      description: 'The newest entries of the caller’s own feed (the `/v1/me/activities` shape).',
    }),
  })
  .meta({
    id: 'Dashboard',
    description:
      'Everything the caller’s dashboard shows, in one call. Only the caller’s own data; a second user’s token gets their own.',
  });

export type Dashboard = z.infer<typeof dashboardSchema>;
export type DashboardProject = z.infer<typeof dashboardProjectSchema>;
