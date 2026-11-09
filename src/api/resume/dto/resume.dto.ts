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

export type ResumeSection = (typeof RESUME_SECTIONS)[number];

export const resumeRequestSchema = z
  .strictObject({
    language: z.enum(['en', 'ru', 'am']).default('en'),
    sections: z
      .array(z.enum(RESUME_SECTIONS))
      .describe(
        'Sections to print, in print order: the order of this array is the order in the PDF. Only listed sections appear; a listed section with no data is omitted.',
      )
      .max(RESUME_SECTIONS.length)
      .refine((v) => new Set(v).size === v.length, 'duplicate section'),
    projectIds: z
      .array(z.uuid())
      .max(50)
      .refine((v) => new Set(v).size === v.length, 'duplicate project')
      .describe(
        'Projects to print, in print order: the order of this array is the order in the Projects section. Omit it to print every visible project of yours, newest first.',
      )
      .optional(),
    includePrivateProjects: z.boolean().default(false),
  })
  .meta({ id: 'ResumeRequest' });

export type ResumeRequest = z.infer<typeof resumeRequestSchema>;
