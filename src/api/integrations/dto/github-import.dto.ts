import { z } from 'zod';

/**
 * The contract of GitHub repository import and re-sync (docs/modules/m7/plan.md §3.2,
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
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .meta({
      description:
        'Search: a case-insensitive substring of the repository’s name, description or language. ' +
        'GitHub cannot search this list, so up to GITHUB_SEARCH_SCAN_PAGES pages of 100 are read ' +
        'and every match in them is returned (`limit` does not apply); `nextCursor` continues ' +
        'after the last page read.',
    }),
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

const repoIdsSchema = z
  .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
  .min(1)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'must not repeat an id' })
  .meta({ description: '1 to GITHUB_IMPORT_MAX_BATCH (10) repository ids, each once.' });

/**
 * What the student changed in a draft before saving (the review step). Only
 * these five fields: the repository facts, `source` and visibility are not
 * writable here. Validated like a manual project create.
 */
export const githubDraftOverridesSchema = z
  .strictObject({
    title: z.string().max(5000),
    summary: z.string().max(70_000).nullable(),
    descriptionHtml: z.string().max(500_000).nullable().meta({
      description: 'Sanitized like any description. Omit to keep the README from GitHub.',
    }),
    technologies: z.array(z.string().max(500)).max(100),
    links: z
      .array(z.strictObject({ label: z.string().max(500), url: z.string().max(5000) }))
      .max(100),
  })
  .partial()
  .meta({ id: 'GithubDraftOverrides' });

export const githubImportRequestSchema = z
  .strictObject({
    repoIds: repoIdsSchema,
    overrides: z
      .record(z.string().regex(/^[1-9]\d{0,15}$/), githubDraftOverridesSchema)
      .optional()
      .meta({
        description:
          'Per repository id (a key of `repoIds`), the fields the student edited in the review ' +
          'step. The README still comes from GitHub unless `descriptionHtml` is given. The ' +
          're-sync snapshot records what GitHub gave, not these, so a later re-sync keeps them.',
      }),
  })
  .refine((v) => Object.keys(v.overrides ?? {}).every((k) => v.repoIds.includes(Number(k))), {
    path: ['overrides'],
    message: 'must only name repositories in repoIds',
  });

export const githubPreviewRequestSchema = z.strictObject({ repoIds: repoIdsSchema });

export const githubDraftSchema = z
  .object({
    title: z.string(),
    summary: z.string().nullable(),
    descriptionHtml: z
      .string()
      .nullable()
      .meta({ description: 'The README, sanitized; images dropped.' }),
    technologies: z.array(z.string()),
    links: z.array(z.object({ label: z.string(), url: z.string() })),
    repoUrl: z.string().meta({ description: 'Shown, not editable.' }),
    isPublic: z.boolean().meta({ description: 'The repository is public; not editable here.' }),
  })
  .meta({ id: 'GithubDraft' });

export const githubPreviewResultSchema = z
  .object({
    repoId: z.number().int(),
    outcome: z.enum(['draft', 'exists', 'skipped']),
    reason: z.enum(['not_found', 'not_owner', 'invalid_repository']).nullable(),
    projectId: z.string().nullable().meta({ description: 'The existing project, for `exists`.' }),
    draft: githubDraftSchema
      .nullable()
      .meta({ description: 'What an import would create; null unless `draft`.' }),
    notes: z.array(z.enum(['README_TOO_LARGE'])),
  })
  .meta({ id: 'GithubPreviewResult' });

export const githubPreviewResponseSchema = z.object({
  results: z.array(githubPreviewResultSchema),
  rateLimit: githubRateLimitSchema,
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
