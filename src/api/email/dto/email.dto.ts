import { z } from 'zod';

export const emailPreferencesSchema = z
  .object({
    teamInvitesEnabled: z.boolean(),
    preferredLanguage: z.enum(['en', 'ru', 'am']),
  })
  .meta({ id: 'EmailPreferences' });
export const emailPreferencesPatchSchema = emailPreferencesSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'provide a preference');
export const unsubscribeSchema = z.strictObject({ token: z.string().min(1).max(1000) });
export const unsubscribeResultSchema = z.object({ unsubscribed: z.literal(true) });
export type EmailPreferencesPatch = z.infer<typeof emailPreferencesPatchSchema>;
