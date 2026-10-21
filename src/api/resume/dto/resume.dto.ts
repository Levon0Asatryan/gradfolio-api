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
