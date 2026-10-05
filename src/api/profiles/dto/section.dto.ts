import { z } from 'zod';
import { stringList } from '../../../core/validation/json-shapes.js';
import { TEXT } from '../../../core/validation/text.js';
import { term } from '../../../core/validation/terms.js';
import { yearMonth } from '../../../core/validation/year-month.js';
import { nullableText, nullableUrl, requiredText, text } from './fields.js';

/**
 * Requests for the ordered profile sections. Each `create*` schema is the
 * complete rule set; `patch*` is the same fields, all optional, and the
 * service merges a patch into the stored row and validates the *whole* result
 * with `create*`, so a cross-field rule (`endYear >= startYear`) holds even
 * when one request changes only one of the two.
 *
 * Strict: an unknown key (`id`, `userId`, `sortOrder` …) is a 400, never
 * silently ignored or written.
 */

export const MAX_HIGHLIGHTS = 20;
export const MAX_ACHIEVEMENTS = 20;
export const MAX_EXPERIENCE_SKILLS = 30;

const startYear = z.number().int().min(1900).max(2100);
const endYear = z.union([z.null(), startYear]);
const monthOrNull = z.union([z.null(), yearMonth]);

const educationFields = {
  institution: requiredText('education.institution'),
  degree: requiredText('education.degree'),
  field: requiredText('education.field'),
  startYear,
  endYear,
  description: nullableText('education.description'),
  highlights: stringList({ maxItems: MAX_HIGHLIGHTS }),
};

export const createEducationSchema = z
  .strictObject({
    ...educationFields,
    endYear: educationFields.endYear.default(null),
    description: educationFields.description.default(null),
    highlights: educationFields.highlights.default([]),
  })
  .refine((v) => v.endYear === null || v.endYear >= v.startYear, {
    path: ['endYear'],
    message: 'must not be before startYear',
  });
export const patchEducationSchema = z.strictObject(educationFields).partial();

const experienceFields = {
  title: requiredText('experience.title'),
  organization: requiredText('experience.organization'),
  start: yearMonth,
  end: monthOrNull,
  summary: text('experience.summary'),
  achievements: stringList({ maxItems: MAX_ACHIEVEMENTS }),
  skills: z.array(term).max(MAX_EXPERIENCE_SKILLS),
};

export const createExperienceSchema = z
  .strictObject({
    ...experienceFields,
    end: experienceFields.end.default(null),
    achievements: experienceFields.achievements.default([]),
    skills: experienceFields.skills.default([]),
  })
  .refine((v) => v.end === null || v.end >= v.start, {
    path: ['end'],
    message: 'must not be before start',
  });
export const patchExperienceSchema = z.strictObject(experienceFields).partial();

const certificationFields = {
  name: requiredText('certifications.name'),
  issuer: requiredText('certifications.issuer'),
  date: yearMonth,
  credentialUrl: nullableUrl(TEXT),
};

export const createCertificationSchema = z.strictObject({
  ...certificationFields,
  credentialUrl: certificationFields.credentialUrl.default(null),
});
export const patchCertificationSchema = z.strictObject(certificationFields).partial();

/** A patch must name at least one field. */
export const nonEmptyPatch = <T extends z.ZodType<Record<string, unknown>>>(schema: T) =>
  schema.refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'must change at least one field',
  });

export const itemIdParamSchema = z.object({
  id: z.string().meta({ description: 'The entry id (UUID)', example: '0b6f2c1e-…' }),
});

/** `PUT …/order`: every id of the caller's section, in the new order. */
export const reorderSchema = z
  .strictObject({
    ids: z
      .array(z.string().max(36))
      .max(1000)
      .meta({ description: 'Exactly the ids of the section’s entries, each once.' }),
  })
  .refine((v) => new Set(v.ids).size === v.ids.length, {
    path: ['ids'],
    message: 'must not repeat an id',
  });

/** `PUT /v1/me/skills`: the whole list, in order. */
export const replaceSkillsSchema = z.strictObject({
  skills: z
    .array(term)
    .max(1000)
    .meta({ description: 'Replaces the list. Case-insensitive duplicates collapse.' }),
});

export const skillsResponseSchema = z.object({ skills: z.array(z.string()) });
export const sectionResponseSchema = (item: z.ZodType) => z.array(item);

export type CreateEducation = z.output<typeof createEducationSchema>;
export type CreateExperience = z.output<typeof createExperienceSchema>;
export type CreateCertification = z.output<typeof createCertificationSchema>;
