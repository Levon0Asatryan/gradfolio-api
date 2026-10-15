import { z } from 'zod';

/**
 * The contract of GitHub repository import and re-sync (docs/m7-plan.md §3.2,
 * §3.3, §3.5; §7 items 5–7). Documented in openapi.yaml now; served from M7
 * PR (b), which validates with these schemas. A caller never sends a URL: only
 * integer repository ids and an opaque cursor.
 */

/** GitHub's rate limit for the caller, from the last GitHub answer. */
const githubRateLimitSchema = z
  .object({
    remaining: z.number().int().nullable(),
    resetsAt: z.string().nullable().meta({ description: 'ISO 8601, UTC.' }),
  })
  .meta({ id: 'GithubRateLimit' });

export const githubReposQuerySchema = z.strictObject({
  cursor: z
    .string()
    .max(20)
    .optional()
    .meta({ description: 'Opaque: `nextCursor` of the previous page. Omit for the first.' }),
  limit: z.coerce.number().int().min(1).max(30).optional().meta({
    description: 'Repositories per page, at most GITHUB_PAGE_MAX (30).',
  }),
});

export const githubRepoSchema = z
  .object({
    repoId: z.number().int().meta({ description: 'GitHub’s repository id: what import takes.' }),
    fullName: z.string().meta({ example: 'ani-p/thesis-tracker' }),
    description: z.string().nullable(),
    language: z.string().nullable(),
    stars: z.number().int(),
    forks: z.number().int(),
    fork: z.boolean(),
    archived: z.boolean(),
    pushedAt: z.string().nullable().meta({ description: 'ISO 8601, UTC.' }),
    imported: z.boolean(),
    projectId: z.string().nullable().meta({ description: 'The caller’s project, when imported.' }),
  })
  .meta({ id: 'GithubRepo' });

export const githubRepoPageSchema = z.object({
  items: z.array(githubRepoSchema),
  nextCursor: z.string().nullable(),
  rateLimit: githubRateLimitSchema,
});

export const githubImportRequestSchema = z.strictObject({
  repoIds: z
    .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'must not repeat an id' })
    .meta({ description: '1 to GITHUB_IMPORT_MAX_BATCH (10) repository ids, each once.' }),
});

export const githubImportResultSchema = z
  .object({
    repoId: z.number().int(),
    outcome: z.enum(['created', 'exists', 'skipped']),
    reason: z
      .enum(['not_found', 'not_owner', 'invalid_repository', 'LIMIT_REACHED'])
      .nullable()
      .meta({
        description:
          'Why it was skipped: `not_owner` when the caller neither owns it nor may push to it; ' +
          '`invalid_repository` when GitHub’s data cannot be stored as a project.',
      }),
    projectId: z
      .string()
      .nullable()
      .meta({ description: 'The draft created, or the existing one.' }),
    notes: z.array(z.enum(['README_TOO_LARGE'])).meta({
      description: '`README_TOO_LARGE`: created without a description.',
    }),
  })
  .meta({ id: 'GithubImportResult' });

export const githubImportResponseSchema = z.object({
  results: z.array(githubImportResultSchema),
  rateLimit: githubRateLimitSchema,
});

export const githubSyncQuerySchema = z.strictObject({
  dryRun: z.enum(['true', 'false']).optional().meta({
    description: '`true`: compute and report, change nothing.',
  }),
});

const syncedField = z.enum(['title', 'summary', 'descriptionHtml', 'repoUrl', 'technologies']);

export const githubSyncResponseSchema = z
  .object({
    dryRun: z.boolean(),
    fields: z.array(
      z.object({
        field: syncedField,
        outcome: z.enum(['unchanged', 'updated', 'kept', 'conflict']).meta({
          description:
            '`kept`: the caller edited it and GitHub did not change; `conflict`: both changed, ' +
            'the caller’s value is kept and GitHub’s is in `githubValue`.',
        }),
        githubValue: z
          .union([z.string(), z.array(z.string())])
          .nullable()
          .optional()
          .meta({ description: 'Only on `conflict`.' }),
      }),
    ),
    systemUpdated: z
      .array(
        z.object({
          field: z.enum(['stars', 'forks', 'language', 'readmeUrl']),
          value: z.union([z.number(), z.string()]).nullable(),
        }),
      )
      .meta({ description: 'Repository facts refreshed silently (D8), only those that changed.' }),
  })
  .meta({ id: 'GithubSyncResult' });
