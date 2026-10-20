import { z } from 'zod';

export const RESUME_SECTIONS = [
  'contact',
  'bio',
  'education',
  'experience',
  'projects',
  'skills',
  'certifications',
] as const;

export const resumeRequestSchema = z
  .strictObject({
    language: z.enum(['en', 'ru', 'am']).default('en'),
    sections: z
      .array(z.enum(RESUME_SECTIONS))
      .max(RESUME_SECTIONS.length)
      .refine((v) => new Set(v).size === v.length, 'duplicate section'),
    projectIds: z
      .array(z.uuid())
      .max(50)
      .refine((v) => new Set(v).size === v.length, 'duplicate project')
      .optional(),
    includePrivateProjects: z.boolean().default(false),
  })
  .meta({ id: 'ResumeRequest' });

export type ResumeRequest = z.infer<typeof resumeRequestSchema>;
export interface ResumeData {
  name: string;
  headline: string;
  blocks: { title: string; entries: { title?: string; text: string; url?: string }[] }[];
}

export const RESUME_LABELS = {
  en: {
    contact: 'Contact',
    bio: 'About',
    education: 'Education',
    experience: 'Experience',
    projects: 'Projects',
    skills: 'Skills',
    certifications: 'Certifications',
    present: 'Present',
  },
  ru: {
    contact: 'Контакты',
    bio: 'О себе',
    education: 'Образование',
    experience: 'Опыт работы',
    projects: 'Проекты',
    skills: 'Навыки',
    certifications: 'Сертификаты',
    present: 'По настоящее время',
  },
  am: {
    contact: 'Կոնտակտներ',
    bio: 'Իմ մասին',
    education: 'Կրթություն',
    experience: 'Աշխատանքային փորձ',
    projects: 'Նախագծեր',
    skills: 'Հմտություններ',
    certifications: 'Հավաստագրեր',
    present: 'Մինչ օրս',
  },
} as const;

/** PDF links are annotations: validate their schemes even for legacy rows. */
export function resumeUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  const url = URL.parse(value);
  return url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
    ? url.href
    : undefined;
}
