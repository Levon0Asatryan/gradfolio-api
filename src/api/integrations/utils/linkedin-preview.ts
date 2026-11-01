import type { z } from 'zod';
import type { ParsedItem } from '../../../core/linkedin-export/parse-dataset.js';
import type { ZipReadResult } from '../../../core/linkedin-export/zip-reader.js';
import { term } from '../../../core/validation/terms.js';
import {
  createCertificationSchema,
  createEducationSchema,
  createExperienceSchema,
} from '../../profiles/dto/section.dto.js';
import { certificationKey, educationKey, experienceKey, skillKey } from './linkedin-keys.js';

/** What the caller already has, reduced to the fields the keys use. */
export interface ExistingProfile {
  experience: { title: string; organization: string; start: string }[];
  education: { institution: string; degree: string; startYear: number }[];
  certifications: { name: string; issuer: string; date: string }[];
  skills: string[];
}

export type PreviewStatus = 'new' | 'duplicate' | 'invalid';

export interface PreviewItem {
  status: PreviewStatus;
  fields: Record<string, unknown>;
  problems: { field: string; code: string }[];
}

export interface Preview {
  experience: PreviewItem[];
  education: PreviewItem[];
  certifications: PreviewItem[];
  skills: { name: string; status: PreviewStatus }[];
}

/**
 * The parsed items checked the way a manual entry would be: the same schemas the confirm
 * applies. A key match with an existing (or earlier) entry is `duplicate`, whatever else is
 * wrong with the item; otherwise any problem, the parser's or the schema's, is `invalid`.
 * Nothing is saved, and `invalid` items are still returned so the student can fix them.
 */
function classify<F extends object>(
  items: ParsedItem<F>[],
  schema: z.ZodType,
  keyOf: (f: F) => string | null,
  existing: Set<string>,
): PreviewItem[] {
  const seen = new Set(existing);
  return items.map(({ fields, problems }) => {
    const copy = { ...fields } as Record<string, unknown>;
    const key = keyOf(fields);
    if (key !== null && seen.has(key)) {
      return { status: 'duplicate', fields: copy, problems: [] };
    }
    if (key !== null) seen.add(key);

    const merged: { field: string; code: string }[] = [...problems];
    const result = schema.safeParse(fields);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0] ?? '');
        if (!merged.some((p) => p.field === field)) merged.push({ field, code: 'INVALID' });
      }
    }
    return {
      status: merged.length > 0 ? 'invalid' : 'new',
      fields: copy,
      problems: merged,
    };
  });
}

export function buildPreview(read: ZipReadResult, existing: ExistingProfile): Preview {
  const { positions, education, certifications, skills } = read.outcomes;

  const skillSeen = new Set(existing.skills.map(skillKey));
  const skillItems = (skills?.items ?? []).map(({ fields }) => {
    const key = skillKey(fields.name);
    if (skillSeen.has(key)) return { name: fields.name, status: 'duplicate' as const };
    skillSeen.add(key);
    return {
      name: fields.name,
      status: term.safeParse(fields.name).success ? ('new' as const) : ('invalid' as const),
    };
  });

  return {
    experience: classify(
      positions?.items ?? [],
      createExperienceSchema,
      experienceKey,
      new Set(existing.experience.map(experienceKey).filter((k) => k !== null)),
    ),
    education: classify(
      education?.items ?? [],
      createEducationSchema,
      educationKey,
      new Set(existing.education.map(educationKey).filter((k) => k !== null)),
    ),
    certifications: classify(
      certifications?.items ?? [],
      createCertificationSchema,
      certificationKey,
      new Set(existing.certifications.map(certificationKey).filter((k) => k !== null)),
    ),
    skills: skillItems,
  };
}
