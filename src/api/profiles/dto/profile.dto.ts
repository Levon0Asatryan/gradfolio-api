import { z } from 'zod';
import { columnString } from '../../../core/validation/columns.js';
import { httpUrl } from '../../../core/validation/http-url.js';
import { chars, fits, TEXT } from '../../../core/validation/text.js';

const emptyToNull = (v: string): string | null => (v === '' ? null : v);

/** A trimmed string that fits the column; used for required text. */
const text = (column: Parameters<typeof columnString>[0]) =>
  z.string().trim().pipe(columnString(column));

/** Nullable text: `null` or a blank string clears the field. */
const nullableText = (column: Parameters<typeof columnString>[0]) =>
  z.union([
    z.null(),
    z
      .string()
      .trim()
      .transform(emptyToNull)
      .pipe(z.union([z.null(), columnString(column)])),
  ]);

/** A nullable `http(s)` URL: `null` or a blank string clears the field. */
const nullableUrl = (limit: Parameters<typeof httpUrl>[0]) =>
  z.union([
    z.null(),
    z
      .string()
      .trim()
      .transform(emptyToNull)
      .pipe(z.union([z.null(), httpUrl(limit)])),
  ]);

const CONTACT_EMAIL_LIMIT = chars(255);
const nullableEmail = z.union([
  z.null(),
  z
    .string()
    .trim()
    .transform(emptyToNull)
    .pipe(
      z.union([
        z.null(),
        z.email().refine((v) => fits(v, CONTACT_EMAIL_LIMIT), {
          message: 'must be at most 255 characters',
        }),
      ]),
    ),
]);

// ---------------------------------------------------------------- responses

export const profileLinksSchema = z
  .object({
    github: z.string().nullable(),
    linkedin: z.string().nullable(),
    twitter: z.string().nullable(),
    website: z.string().nullable(),
  })
  .meta({ id: 'ProfileLinks' });

/** The fields the owner edits in `PATCH /v1/me/profile`. */
export const profileHeaderSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    headline: z.string(),
    bio: z.string().nullable().meta({ description: 'Plain text. Never HTML.' }),
    location: z.string().nullable(),
    avatarUrl: z.string().nullable().meta({ description: 'An http(s) URL (URL-only until M4).' }),
    contactEmail: z
      .string()
      .nullable()
      .meta({ description: 'Public contact address the user chose. Not the login email.' }),
    isPublic: z.boolean().meta({ description: 'false: only the owner can read the profile.' }),
    links: profileLinksSchema,
  })
  .meta({ id: 'ProfileHeader' });

export const educationSchema = z
  .object({
    id: z.string(),
    institution: z.string(),
    degree: z.string(),
    field: z.string(),
    startYear: z.number().int(),
    endYear: z.number().int().nullable().meta({ description: 'null: still studying.' }),
    description: z.string().nullable(),
    highlights: z.array(z.string()),
  })
  .meta({ id: 'Education' });

export const experienceSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    organization: z.string(),
    start: z.string().meta({ description: 'YYYY-MM', example: '2024-06' }),
    end: z.string().nullable().meta({ description: 'YYYY-MM; null: present.' }),
    summary: z.string(),
    achievements: z.array(z.string()),
    skills: z.array(z.string()),
  })
  .meta({ id: 'Experience' });

export const certificationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    issuer: z.string(),
    date: z.string().meta({ description: 'YYYY-MM', example: '2025-01' }),
    credentialUrl: z.string().nullable(),
  })
  .meta({ id: 'Certification' });

export const profileProjectSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    category: z.enum(['academic', 'personal', 'research', 'hackathon', 'course', 'other']),
    status: z.enum(['ongoing', 'completed', 'archived']),
    heroImageUrl: z.string().nullable(),
    tags: z.array(z.string()),
    role: z.enum(['owner', 'member']).meta({
      description: 'owner: the profile owner created it; member: accepted team member.',
    }),
    isPublic: z.boolean(),
    isDraft: z.boolean(),
  })
  .meta({ id: 'ProfileProject' });

export const profileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    headline: z.string(),
    bio: z.string().nullable(),
    location: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    verified: z.boolean(),
    contactEmail: z.string().nullable(),
    links: profileLinksSchema,
    isOwner: z.boolean().meta({ description: 'The caller is the profile owner.' }),
    isPublic: z.boolean(),
    education: z.array(educationSchema),
    experience: z.array(experienceSchema),
    certifications: z.array(certificationSchema),
    skills: z.array(z.string()),
    projects: z.array(profileProjectSchema).meta({
      description:
        'Own and accepted-team projects, newest first. Others see public, published ones only; the owner also sees their own private and draft ones.',
    }),
  })
  .meta({ id: 'Profile' });

export type ProfileResponse = z.infer<typeof profileSchema>;
export type ProfileHeader = z.infer<typeof profileHeaderSchema>;
export type ProfileProject = z.infer<typeof profileProjectSchema>;

export const onboardingResponseSchema = z.object({ onboarded: z.literal(true) });

// ----------------------------------------------------------------- requests

const linksPatchSchema = z.strictObject({
  github: nullableUrl(chars(500)).optional(),
  linkedin: nullableUrl(chars(500)).optional(),
  twitter: nullableUrl(chars(500)).optional(),
  website: nullableUrl(chars(500)).optional(),
});

/**
 * `PATCH /v1/me/profile`. Strict: an unknown key (`verified`, `email`,
 * `auth0Id`, `phone`, `birthday`, `id` …) is a 400, never silently ignored and
 * never written (OWASP API3, mass assignment). At least one field must change.
 */
export const updateProfileSchema = z
  .strictObject({
    name: text('users.name').refine((v) => v.length > 0, { message: 'must not be empty' }),
    headline: text('users.headline'),
    bio: nullableText('users.bio'),
    location: nullableText('users.location'),
    avatarUrl: nullableUrl(TEXT),
    contactEmail: nullableEmail,
    isPublic: z.boolean(),
    links: linksPatchSchema,
  })
  .partial()
  .refine(
    (v) =>
      Object.keys(v).some((k) => k !== 'links' && v[k as keyof typeof v] !== undefined) ||
      Object.values(v.links ?? {}).some((x) => x !== undefined),
    { message: 'must change at least one field' },
  );

export type UpdateProfile = z.output<typeof updateProfileSchema>;

export const userIdParamSchema = z.object({
  id: z.string().meta({ description: 'The user id (UUID)', example: '0b6f2c1e-…' }),
});
