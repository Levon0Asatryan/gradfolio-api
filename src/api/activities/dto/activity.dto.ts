import { z } from 'zod';

export const activitySchema = z
  .object({
    id: z.string(),
    type: z.enum(['project', 'profile']),
    translationKey: z.string().meta({
      description:
        'What happened, e.g. `projectCreated`, `newSkill`, `teamJoined`. Render the text from your own strings for this key; an unknown key gets a generic line.',
    }),
    translationParams: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .nullable()
      .meta({
        description:
          'Placeholders for the text: `projectName`, `skillName`, `memberName`, and `projectId` for a link. Only what the feed’s owner may see.',
      }),
    timestamp: z.string().meta({ description: 'ISO 8601, UTC.' }),
  })
  .meta({ id: 'Activity' });

export const activityPageSchema = z
  .object({
    items: z.array(activitySchema),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'Pass as `cursor`; null on the last page.' }),
  })
  .meta({ id: 'ActivityPage' });

/** Unknown query keys are a 400, like everywhere else. */
export const activityQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .meta({ description: 'Page size; at most ACTIVITIES_PAGE_MAX (50); 20 when omitted.' }),
  cursor: z.string().min(1).max(600).optional().meta({
    description: 'The `nextCursor` of the previous page. Anything else is 400.',
  }),
});

export type ActivityPage = z.infer<typeof activityPageSchema>;
export type ActivityQuery = z.output<typeof activityQuerySchema>;
