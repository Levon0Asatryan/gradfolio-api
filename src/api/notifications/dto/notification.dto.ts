import { z } from 'zod';

/** The types the API exposes; any other stored type reads as `general`. */
export const NOTIFICATION_TYPES = [
  'team_invite',
  'team_accepted',
  'team_rejected',
  'team_left',
  'general',
] as const;

export const INVITE_STATUSES = ['pending', 'accepted', 'rejected', 'gone'] as const;

export const notificationParamsOutSchema = z
  .object({
    actorId: z.string().nullable().meta({
      description:
        'The person who caused it, for a profile link. null when their account is gone or their profile is not visible to the reader.',
    }),
    actorName: z.string(),
    projectId: z.string(),
    projectTitle: z.string(),
    role: z.string().nullable(),
  })
  .meta({
    id: 'NotificationParams',
    description:
      'Names saved when the notification was written, so it still reads after the project or the person is gone. Render the text from `type` and these.',
  });

export const notificationInviteSchema = z
  .object({
    status: z.enum(INVITE_STATUSES).meta({
      description:
        'The reader’s membership now. Offer accept/reject only while `pending`; `gone`: the invitation or the project no longer exists.',
    }),
  })
  .meta({ id: 'NotificationInvite' });

export const notificationSchema = z
  .object({
    id: z.string(),
    type: z.enum(NOTIFICATION_TYPES),
    title: z
      .string()
      .meta({ description: 'English fallback text. Prefer rendering `type` + `params`.' }),
    params: notificationParamsOutSchema.nullable().meta({
      description: 'null on a notification written before params existed: show `title`.',
    }),
    read: z.boolean(),
    createdAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
    link: z.string().nullable().meta({
      description:
        'App path computed when read: `/projects/<id>` while the project exists and the reader may open it, else null. Never stored.',
    }),
    invite: notificationInviteSchema.nullable().meta({ description: 'Only on `team_invite`.' }),
  })
  .meta({ id: 'Notification' });

export const notificationPageSchema = z
  .object({
    items: z.array(notificationSchema),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'Pass as `cursor`; null on the last page.' }),
  })
  .meta({ id: 'NotificationPage' });

export const unreadCountSchema = z.object({ count: z.number().int() }).meta({ id: 'UnreadCount' });
export const readAllResultSchema = z
  .object({ updated: z.number().int() })
  .meta({ id: 'ReadAllResult' });

export const notificationIdParamSchema = z.object({
  id: z.string().meta({ description: 'The notification id (UUID)' }),
});

/** Unknown query keys are a 400, like everywhere else. */
export const notificationQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .meta({ description: 'Page size; at most NOTIFICATIONS_PAGE_MAX (50); 20 when omitted.' }),
  cursor: z.string().min(1).max(600).optional().meta({
    description: 'The `nextCursor` of the previous page. Anything else is 400.',
  }),
});

export type Notification = z.infer<typeof notificationSchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export type NotificationQuery = z.output<typeof notificationQuerySchema>;
