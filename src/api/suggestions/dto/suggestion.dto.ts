import { z } from 'zod';

/**
 * Suggestions (docs/modules/m7/plan.md §6): proposals the student accepts or dismisses.
 * Nothing is applied without an accept. Owner only; no route takes anything
 * but the caller's own suggestion id (another's is 404).
 */

export const SUGGESTION_KINDS = [
  'profile.name',
  'profile.headline',
  'profile.bio',
  'profile.location',
  'profile.avatarUrl',
  'profile.links.github',
  'profile.links.website',
  'linkedin.reimport',
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const SUGGESTION_STATUSES = ['open', 'accepted', 'dismissed', 'superseded'] as const;

export const suggestionSchema = z
  .object({
    id: z.string(),
    kind: z.enum(SUGGESTION_KINDS),
    source: z.enum(['github', 'linkedin', 'auth0']),
    status: z.enum(SUGGESTION_STATUSES),
    field: z.string().nullable().meta({
      description:
        'The profile field a `profile.*` suggestion would change (`bio`, `links.github` …); null for a reminder.',
    }),
    current: z.string().nullable().meta({
      description: 'The field’s value now (open suggestions only); null when empty.',
    }),
    proposed: z.string().nullable().meta({ description: 'The value an accept would write.' }),
    mode: z.enum(['fill', 'replace']).nullable().meta({
      description: '`fill`: the field is empty now; `replace`: it holds a different value.',
    }),
    lastSyncedAt: z.string().nullable().meta({
      description: '`linkedin.reimport` only: the last confirmed export import, ISO 8601.',
    }),
    createdAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
    resolvedAt: z.string().nullable(),
  })
  .meta({ id: 'SuggestionItem' });
export type SuggestionView = z.infer<typeof suggestionSchema>;

export const suggestionPageSchema = z
  .object({
    items: z.array(suggestionSchema),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'Pass as `cursor`; null on the last page.' }),
    openCount: z.number().int().meta({ description: 'Open suggestions the caller has, in all.' }),
  })
  .meta({ id: 'SuggestionPage' });
export type SuggestionPage = z.infer<typeof suggestionPageSchema>;

export const suggestionQuerySchema = z.strictObject({
  status: z.enum(['open', 'all']).default('open'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type SuggestionQuery = z.output<typeof suggestionQuerySchema>;

export const suggestionIdParamSchema = z.object({
  id: z.string().meta({ description: 'The suggestion id (UUID)', example: '0b6f2c1e-…' }),
});

export const refreshResponseSchema = z
  .object({
    github: z.enum(['refreshed', 'unchanged', 'throttled', 'discarded', 'not_connected']).meta({
      description:
        '`refreshed`: GitHub was read; `unchanged`: GitHub answered 304; `throttled`: read less ' +
        'than SUGGESTIONS_MIN_INTERVAL_S ago, the stored profile was used; `discarded`: GitHub was ' +
        'read but the connection it was read for was disconnected and replaced meanwhile, so ' +
        'nothing of it was applied (refresh again); `not_connected`.',
    }),
    nextAllowedAt: z.string().nullable().meta({
      description: 'When GitHub may be read again, ISO 8601; null when not connected.',
    }),
    created: z.number().int().meta({ description: 'Suggestions this refresh opened.' }),
    openCount: z.number().int(),
  })
  .meta({ id: 'SuggestionRefresh' });
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const resolveResponseSchema = z
  .object({
    id: z.string(),
    status: z.enum(['accepted', 'dismissed']),
    applied: z
      .object({ field: z.string(), value: z.string().nullable() })
      .nullable()
      .meta({ description: 'What an accept wrote; null for a dismiss or a reminder.' }),
  })
  .meta({ id: 'SuggestionResolved' });
export type ResolveResponse = z.infer<typeof resolveResponseSchema>;
