import { z } from 'zod';
import { linkList } from '../../../core/validation/json-shapes.js';
import { sanitizeDescription, type SanitizedHtml } from '../../../core/validation/html.js';
import { termList } from '../../../core/validation/terms.js';
import { LONGTEXT, measure, TEXT } from '../../../core/validation/text.js';
import {
  nullableHttpsUrl,
  nullableText,
  nullableUrl,
  requiredText,
} from '../../profiles/dto/fields.js';
import { PROJECT_CATEGORIES, PROJECT_STATUSES } from './project.dto.js';

/**
 * Requests for `POST /v1/projects` and `PATCH /v1/projects/:id`.
 *
 * `create` is the complete rule set; `patch` is the same fields, all optional,
 * and the service merges a patch into the stored project and validates the
 * *whole* result with `create`, so a cross-field rule (`endDate >= startDate`)
 * holds when a request changes only one of the two.
 *
 * Strict: `id`, `userId`, `source`, `repo*` (except `repoUrl`), `aiSummary`,
 * the timestamps and anything unknown are a 400, never written (OWASP API3).
 *
 * The limits come from configuration, so the schemas are built from them.
 */
export interface ProjectLimits {
  maxTags: number;
  maxTechnologies: number;
  maxLinks: number;
  descriptionMaxBytes: number;
}

export const DEFAULT_PROJECT_LIMITS: ProjectLimits = {
  maxTags: 20,
  maxTechnologies: 30,
  maxLinks: 10,
  descriptionMaxBytes: 100_000,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day: `2025-02-30` matches the pattern and is not one. */
const isoDate = z
  .string()
  .regex(ISO_DATE, { message: 'must be YYYY-MM-DD' })
  .refine(
    (v) => {
      const d = new Date(`${v}T00:00:00Z`);
      // Invalid Dates (2025-13-45) have no ISO string; they must fail, not throw.
      return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
    },
    { message: 'must be a real date' },
  );
const dateOrNull = z.union([z.null(), isoDate]);

export interface ProjectInput {
  title: string;
  summary: string | null;
  descriptionHtml: SanitizedHtml | null;
  category: (typeof PROJECT_CATEGORIES)[number];
  status: (typeof PROJECT_STATUSES)[number];
  isPublic: boolean;
  isDraft: boolean;
  liveDemoUrl: string | null;
  repoUrl: string | null;
  heroImageUrl: string | null;
  metadata: {
    startDate: string | null;
    endDate: string | null;
    course: string | null;
    professor: string | null;
  };
  technologies: string[];
  tags: string[];
  links: { label: string; url: string }[];
  files: { label: string; url: string }[];
}

export function projectWriteSchemas(limits: ProjectLimits) {
  /** Sanitized, then measured: the stored size is what the limit is about. */
  const description = z.union([
    z.null(),
    z
      .string()
      .transform(sanitizeDescription)
      .refine((v) => measure(v, LONGTEXT) <= limits.descriptionMaxBytes, {
        message: `must be at most ${limits.descriptionMaxBytes} bytes after sanitizing`,
      })
      // Blank (or nothing but removed markup) is no description.
      .transform((v): SanitizedHtml | null => (v.trim() === '' ? null : v)),
  ]);

  const metadataFields = {
    startDate: dateOrNull,
    endDate: dateOrNull,
    course: nullableText('projects.meta_course'),
    professor: nullableText('projects.meta_professor'),
  };

  const fields = {
    title: requiredText('projects.title'),
    summary: nullableText('projects.summary'),
    descriptionHtml: description,
    category: z.enum(PROJECT_CATEGORIES),
    status: z.enum(PROJECT_STATUSES),
    isPublic: z.boolean(),
    isDraft: z.boolean(),
    liveDemoUrl: nullableUrl(TEXT),
    repoUrl: nullableUrl(TEXT),
    heroImageUrl: nullableHttpsUrl(TEXT),
    technologies: termList({ maxItems: limits.maxTechnologies }),
    tags: termList({ maxItems: limits.maxTags }),
    links: linkList({ maxItems: limits.maxLinks }),
    files: linkList({ maxItems: limits.maxLinks }),
  };

  const create = z
    .strictObject({
      ...fields,
      descriptionHtml: fields.descriptionHtml.default(null),
      summary: fields.summary.default(null),
      category: fields.category.default('other'),
      status: fields.status.default('ongoing'),
      isPublic: fields.isPublic.default(true),
      isDraft: fields.isDraft.default(false),
      liveDemoUrl: fields.liveDemoUrl.default(null),
      repoUrl: fields.repoUrl.default(null),
      heroImageUrl: fields.heroImageUrl.default(null),
      technologies: fields.technologies.default([]),
      tags: fields.tags.default([]),
      links: fields.links.default([]),
      files: fields.files.default([]),
      metadata: z
        .strictObject({
          startDate: metadataFields.startDate.default(null),
          endDate: metadataFields.endDate.default(null),
          course: metadataFields.course.default(null),
          professor: metadataFields.professor.default(null),
        })
        .default({ startDate: null, endDate: null, course: null, professor: null }),
    })
    .refine(
      (v) =>
        v.metadata.endDate === null ||
        v.metadata.startDate === null ||
        v.metadata.endDate >= v.metadata.startDate,
      {
        path: ['metadata', 'endDate'],
        message: 'must not be before startDate',
      },
    );

  const patch = z
    .strictObject({
      ...fields,
      metadata: z.strictObject(metadataFields).partial(),
    })
    .partial()
    .refine((v) => Object.values(v).some((x) => x !== undefined), {
      message: 'must change at least one field',
    });

  return { create, patch };
}

export type CreateProject = z.output<ReturnType<typeof projectWriteSchemas>['create']>;
export type PatchProject = z.output<ReturnType<typeof projectWriteSchemas>['patch']>;

/** What the OpenAPI document describes, at the default limits. */
export const documentedProjectSchemas = projectWriteSchemas(DEFAULT_PROJECT_LIMITS);
