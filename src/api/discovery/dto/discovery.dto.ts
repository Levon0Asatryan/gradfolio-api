import { z } from 'zod';
import { PROJECT_CATEGORIES, PROJECT_STATUSES } from '../../projects/dto/project.dto.js';
import { CURSOR_MAX_CHARS } from '../utils/discovery-cursor.js';
import {
  charCount,
  normalizeText,
  parseQuery,
  type ParsedQuery,
  QUERY_MAX_CHARS,
  QUERY_MAX_TOKENS,
  TOKEN_MAX_CHARS,
} from '../utils/search-query.js';

// ---------------------------------------------------------------- responses

export const personSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    headline: z.string(),
    avatarUrl: z.string().nullable(),
    verified: z.boolean(),
    location: z.string().nullable(),
    skills: z.array(z.string()).meta({
      description: 'Up to 5, in the owner’s order, in the site-wide spelling of each name.',
    }),
    projectCount: z.number().int().meta({
      description:
        'Published projects that are discoverable: their own and those they are an accepted member of, whose owner’s profile is public.',
    }),
  })
  .meta({
    id: 'PersonSummary',
    description:
      'A public profile as a card. Never an email, contact email, phone, birthday, login id or link.',
  });

export const projectCardOwnerSchema = z
  .object({ id: z.string(), name: z.string(), avatarUrl: z.string().nullable() })
  .meta({ id: 'ProjectCardOwner' });

export const projectCardSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    summary: z.string().nullable().meta({ description: 'The author’s own text. Plain text.' }),
    category: z.enum(PROJECT_CATEGORIES),
    status: z.enum(PROJECT_STATUSES),
    heroImageUrl: z.string().nullable(),
    technologies: z.array(z.string()).meta({ description: 'Up to 5.' }),
    tags: z.array(z.string()).meta({ description: 'Up to 5.' }),
    owner: projectCardOwnerSchema,
    createdAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
    updatedAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
  })
  .meta({
    id: 'ProjectCard',
    description:
      'A published project of a public profile as a card. Never the description, links, files, visibility flags or repository data.',
  });

const group = <T extends z.ZodType>(item: T, id: string) =>
  z.object({ items: z.array(item), hasMore: z.boolean() }).meta({ id });

export const searchResultsSchema = z
  .object({
    query: z.string().meta({ description: 'The query as normalized (what was searched).' }),
    people: group(personSummarySchema, 'PersonGroup'),
    projects: group(projectCardSchema, 'ProjectGroup'),
  })
  .meta({ id: 'SearchResults' });

const nextCursor = z
  .string()
  .nullable()
  .meta({ description: 'Pass as `cursor`; null on the last page.' });

export const personPageSchema = z
  .object({ items: z.array(personSummarySchema), nextCursor })
  .meta({ id: 'PersonPage' });

export const discoveryProjectPageSchema = z
  .object({ items: z.array(projectCardSchema), nextCursor })
  .meta({ id: 'DiscoveryProjectPage' });

export const tagSummarySchema = z
  .object({
    name: z.string().meta({ description: 'The site-wide spelling of the term.' }),
    projectCount: z.number().int(),
    peopleCount: z.number().int(),
  })
  .meta({ id: 'TagSummary' });

export const tagCloudItemSchema = z
  .object({
    name: z.string().meta({ description: 'The site-wide spelling of the term.' }),
    projects: z.number().int().meta({ description: 'Discoverable projects that use it.' }),
    people: z.number().int().meta({ description: 'Public people who list it as a skill.' }),
  })
  .meta({ id: 'TagCloudItem' });

export const tagCloudSchema = z
  .object({
    items: z.array(tagCloudItemSchema),
    generatedAt: z.string().meta({
      description:
        'ISO 8601, UTC: when these counts were computed. A new project can take up to this long plus the cache time (60 s) to show.',
    }),
  })
  .meta({ id: 'TagCloud' });

const facetValue = <T extends z.ZodType>(value: T, id: string) =>
  z.object({ value, count: z.number().int() }).meta({ id });

export const userFacetsSchema = z
  .object({
    schools: z.array(facetValue(z.string(), 'SchoolFacet')),
    majors: z.array(facetValue(z.string(), 'MajorFacet')),
    years: z.array(facetValue(z.number().int(), 'YearFacet')),
    generatedAt: z.string(),
  })
  .meta({
    id: 'UserFacets',
    description:
      'The choices for the directory filters: the values present on public profiles, most common first, at most 50 each.',
  });

// ----------------------------------------------------------------- requests

/**
 * The visitor's text. Normalized (NFKC, control and zero-width characters
 * removed, whitespace collapsed); 1 to 100 characters, at most 6 words of at
 * most 50. More is a 400, never a silent truncation.
 */
const searchText = z.string().transform((raw, ctx): ParsedQuery => {
  const text = normalizeText(raw);
  const n = charCount(text);
  const words = text === '' ? [] : text.split(' ');
  const fail = (message: string) => {
    ctx.addIssue({ code: 'custom', message });
    return z.NEVER;
  };
  if (n < 1) return fail('must not be empty');
  if (n > QUERY_MAX_CHARS) return fail(`must be at most ${QUERY_MAX_CHARS} characters`);
  if (words.length > QUERY_MAX_TOKENS) return fail(`must be at most ${QUERY_MAX_TOKENS} words`);
  if (words.some((w) => charCount(w) > TOKEN_MAX_CHARS)) {
    return fail(`a word must be at most ${TOKEN_MAX_CHARS} characters`);
  }
  return parseQuery(text);
});

const limit = z.coerce.number().int().min(1).optional().meta({
  description: 'Page size; at most DISCOVERY_PAGE_MAX (30); 12 when omitted.',
});
const cursor = z.string().min(1).max(CURSOR_MAX_CHARS).optional().meta({
  description:
    'The `nextCursor` of the previous page of the same list. Anything else is 400. Not signed: it only positions the page, and a forged one still returns only rows that belong to the listing.',
});

const qParam = searchText.meta({
  description:
    'Words to find, 1 to 100 characters, at most 6 words. Every word must match; very common English words are ignored when other words remain.',
});

/** Unknown query keys are a 400, like everywhere else. */
export const searchQuerySchema = z.strictObject({ q: qParam });
export const searchPageQuerySchema = z.strictObject({ q: qParam, limit, cursor });

/** A term as typed: normalized like the stored names, 1 to 255 characters. */
const termName = z
  .string()
  .transform((v) => normalizeText(v))
  .pipe(z.string().min(1).max(255))
  .meta({
    description:
      'The skill, technology or tag, in any case. A query parameter, not a path segment, so names such as `C#` and `CI/CD` need no escaping.',
    example: 'C#',
  });

export const tagQuerySchema = z.strictObject({ name: termName });
export const tagPageQuerySchema = z.strictObject({ name: termName, limit, cursor });

const text200 = (description: string) =>
  z
    .string()
    .transform((v) => normalizeText(v))
    .pipe(z.string().min(1).max(200))
    .meta({ description });

/** Browse projects: unknown keys are 400. Every order ends in the id, so pages never repeat or skip. */
export const BROWSE_PROJECT_SORTS = ['newest', 'updated'] as const;
export const browseProjectsQuerySchema = z.strictObject({
  sort: z.enum(BROWSE_PROJECT_SORTS).default('newest').meta({
    description: 'newest by creation, updated by last change; both newest first.',
  }),
  category: z.enum(PROJECT_CATEGORIES).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  limit,
  cursor,
});

export const BROWSE_USER_SORTS = ['newest'] as const;
export const browseUsersQuerySchema = z.strictObject({
  sort: z.enum(BROWSE_USER_SORTS).default('newest').meta({
    description: 'newest sign-up first. The only order today; sending it is allowed.',
  }),
  school: text200(
    'Institution on an education entry, matched case-insensitively and exactly.',
  ).optional(),
  major: text200('Field of study on an education entry, matched exactly.').optional(),
  gradYear: z.coerce.number().int().min(1950).max(2100).optional().meta({
    description: 'End year of an education entry. One entry must match every filter given.',
  }),
  limit,
  cursor,
});

export const tagCloudQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).optional().meta({
    description: 'Terms to return; at most TAG_CLOUD_MAX (100); 40 when omitted.',
  }),
});

export type BrowseProjectsQuery = z.output<typeof browseProjectsQuerySchema>;
export type BrowseUsersQuery = z.output<typeof browseUsersQuerySchema>;
export type TagCloudQuery = z.output<typeof tagCloudQuerySchema>;
export type TagCloud = z.infer<typeof tagCloudSchema>;
export type UserFacets = z.infer<typeof userFacetsSchema>;
export type SearchQuery = z.output<typeof searchQuerySchema>;
export type SearchPageQuery = z.output<typeof searchPageQuerySchema>;
export type TagQuery = z.output<typeof tagQuerySchema>;
export type TagPageQuery = z.output<typeof tagPageQuerySchema>;
export type PersonSummary = z.infer<typeof personSummarySchema>;
export type ProjectCard = z.infer<typeof projectCardSchema>;
export type SearchResults = z.infer<typeof searchResultsSchema>;
export type PersonPage = z.infer<typeof personPageSchema>;
export type DiscoveryProjectPage = z.infer<typeof discoveryProjectPageSchema>;
export type TagSummary = z.infer<typeof tagSummarySchema>;
