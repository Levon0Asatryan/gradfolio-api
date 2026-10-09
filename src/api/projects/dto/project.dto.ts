import { z } from 'zod';
import { normalizeTerm } from '../../../core/validation/terms.js';
import { PROJECT_SORTS } from '../utils/cursor.js';

export const PROJECT_CATEGORIES = [
  'academic',
  'personal',
  'research',
  'hackathon',
  'course',
  'other',
] as const;
export const PROJECT_STATUSES = ['ongoing', 'completed', 'archived'] as const;
/** Lifecycle of the caller's own projects: what `?state=` filters on. */
export const PROJECT_STATES = ['published', 'private', 'draft'] as const;

// ---------------------------------------------------------------- responses

const isoDate = (description: string) => z.string().meta({ description, example: '2026-10-08' });

export const projectMetadataSchema = z
  .object({
    startDate: isoDate('YYYY-MM-DD').nullable(),
    endDate: isoDate('YYYY-MM-DD; null: ongoing.').nullable(),
    course: z.string().nullable(),
    professor: z.string().nullable(),
  })
  .meta({ id: 'ProjectMetadata' });

export const projectRepoSchema = z
  .object({
    url: z.string().nullable(),
    latestCommitDate: isoDate('YYYY-MM-DD').nullable(),
    readmeUrl: z.string().nullable(),
    stars: z.number().int().nullable(),
    forks: z.number().int().nullable(),
    language: z.string().nullable(),
  })
  .meta({
    id: 'ProjectRepo',
    description: 'Only `url` is writable. The rest is filled by the GitHub import (M7).',
  });

export const projectAttachmentSchema = z
  .object({
    id: z.string(),
    type: z.enum(['image', 'video', 'pdf', 'link']),
    url: z.string(),
    title: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
    embedUrl: z.string().nullable().meta({
      description:
        'Videos on an allow-listed host only: the URL to put in an iframe. Never embed `url`.',
    }),
  })
  .meta({ id: 'ProjectAttachment' });

export const projectTeamMemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    role: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    userId: z.string().nullable().meta({
      description:
        'The member’s account, for a profile link. null when the account is gone or its profile is not visible to the caller.',
    }),
  })
  .meta({ id: 'ProjectTeamMember' });

export const projectOwnerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    avatarUrl: z
      .string()
      .nullable()
      .meta({ description: 'null when the owner’s profile is private.' }),
  })
  .meta({ id: 'ProjectOwner' });

const summaryShape = {
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable().meta({ description: 'The author’s own text. Plain text.' }),
  category: z.enum(PROJECT_CATEGORIES),
  status: z.enum(PROJECT_STATUSES),
  heroImageUrl: z.string().nullable(),
  tags: z.array(z.string()),
  technologies: z.array(z.string()),
  isPublic: z.boolean(),
  isDraft: z.boolean().meta({ description: 'A draft is readable by its owner only.' }),
  isOwner: z.boolean().meta({ description: 'The caller owns the project.' }),
  ownerId: z.string(),
  metadata: projectMetadataSchema,
  createdAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
  updatedAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
};

export const projectSummarySchema = z.object(summaryShape).meta({ id: 'ProjectSummary' });

export const projectDetailSchema = z
  .object({
    ...summaryShape,
    aiSummary: z.string().nullable().meta({ description: 'Generated text (M8); null until then.' }),
    descriptionHtml: z.string().nullable().meta({
      description:
        'Sanitized HTML (allow-list in docs/m4-plan.md §4.1). Render it with a second sanitizer anyway.',
    }),
    liveDemoUrl: z.string().nullable(),
    repo: projectRepoSchema,
    links: z.array(z.object({ label: z.string(), url: z.string() })),
    files: z.array(z.object({ label: z.string(), url: z.string() })),
    attachments: z.array(projectAttachmentSchema),
    team: z.array(projectTeamMemberSchema).meta({
      description: 'Accepted team members, read-only until M5. The owner is `owner`, not a member.',
    }),
    owner: projectOwnerSchema,
    source: z.enum(['manual', 'github']),
  })
  .meta({ id: 'ProjectDetail' });

export const projectPageSchema = z
  .object({
    items: z.array(projectSummarySchema),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'Pass as `cursor`; null on the last page.' }),
  })
  .meta({ id: 'ProjectPage' });

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type ProjectPage = z.infer<typeof projectPageSchema>;

// ----------------------------------------------------------------- requests

export const projectIdParamSchema = z.object({
  id: z.string().meta({ description: 'The project id (UUID)', example: '0b6f2c1e-…' }),
});

/** A search term: trimmed, at most 100 characters. */
const searchText = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1).max(100));

/** A tag or technology filter, normalized like the stored names. */
const termFilter = z.string().transform(normalizeTerm).pipe(z.string().min(1).max(255));

const listFilters = {
  sort: z.enum(PROJECT_SORTS).default('newest').meta({
    description:
      'newest/oldest by creation, updated by last change, name_* by title. Every order ends in the id, so pages never repeat or skip a row.',
  }),
  category: z.enum(PROJECT_CATEGORIES).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  tag: termFilter.optional(),
  technology: termFilter.optional(),
  q: searchText
    .optional()
    .meta({ description: 'Title or technology contains this text (case-insensitive).' }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .meta({ description: 'Page size; at most PROJECTS_PAGE_MAX (default 50).' }),
  cursor: z.string().min(1).max(600).optional().meta({
    description:
      'The `nextCursor` of the previous page, with the same `sort`. Anything else is 400.',
  }),
};

/** Unknown query keys are a 400, like unknown body keys. */
export const userProjectsQuerySchema = z.strictObject(listFilters);
export const myProjectsQuerySchema = z.strictObject({
  ...listFilters,
  state: z.enum(PROJECT_STATES).optional().meta({
    description:
      'published: public and not a draft; private: not public and not a draft; draft: a draft.',
  }),
});

export type UserProjectsQuery = z.output<typeof userProjectsQuerySchema>;
export type MyProjectsQuery = z.output<typeof myProjectsQuerySchema>;
export type ProjectListQuery = UserProjectsQuery & { state?: MyProjectsQuery['state'] };
