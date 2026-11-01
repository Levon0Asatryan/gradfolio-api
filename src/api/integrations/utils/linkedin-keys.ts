import { normalizeTerm } from '../../../core/validation/terms.js';

/**
 * The natural keys that decide whether a LinkedIn entry is already on the profile
 * (docs/modules/m7/plan.md §4.3): the preview marks a match `duplicate`, and the confirm
 * skips it. Text is compared NFC-normalised, whitespace-collapsed and lower-cased; a key
 * with a missing part is `null`, never equal to anything (no key, no match).
 */
const fold = (s: string): string => normalizeTerm(s).toLowerCase();

const join = (parts: (string | number | null | undefined)[]): string | null => {
  if (parts.some((p) => p === null || p === undefined || p === '')) return null;
  return parts.map((p) => (typeof p === 'string' ? fold(p) : String(p))).join('\u0000');
};

export const experienceKey = (e: {
  title: string;
  organization: string;
  start: string | null;
}): string | null => join([e.title, e.organization, e.start]);

export const educationKey = (e: {
  institution: string;
  degree: string;
  startYear: number | null;
}): string | null => join([e.institution, e.degree, e.startYear]);

export const certificationKey = (e: {
  name: string;
  issuer: string;
  date: string | null;
}): string | null => join([e.name, e.issuer, e.date]);

export const skillKey = (name: string): string => fold(name);
