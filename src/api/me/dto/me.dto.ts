import { z } from 'zod';

/** `GET /v1/me`: the caller's own account. No `auth0_id`, phone or birthday. */
export const meResponseSchema = z.object({
  id: z.string().meta({ description: 'The user id (UUID)', example: '0b6f2c1e-…' }),
  name: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  headline: z.string(),
  verified: z.boolean().meta({ description: 'Email verified with Auth0 (GitHub from M7).' }),
  isPublic: z.boolean(),
  identities: z
    .array(z.string())
    .meta({ description: 'Login providers linked to the account, e.g. `google-oauth2`.' }),
});

export type MeResponse = z.infer<typeof meResponseSchema>;
