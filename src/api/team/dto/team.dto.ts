import { z } from 'zod';
import { nullableText, requiredText } from '../../profiles/dto/fields.js';

export const TEAM_STATUSES = ['pending', 'accepted', 'rejected'] as const;

export const teamMemberSchema = z
  .object({
    id: z.string().meta({ description: 'The membership id, for removing it.' }),
    name: z.string(),
    role: z.string().nullable(),
    status: z.enum(TEAM_STATUSES).meta({
      description:
        'pending: invited, no answer yet. accepted: on the team (every external name is accepted). rejected: declined; the owner may invite again.',
    }),
    userId: z.string().nullable().meta({
      description:
        'The member’s account, for a profile link. null for a name without an account, or when the account is gone or its profile is private.',
    }),
    avatarUrl: z.string().nullable(),
    createdAt: z
      .string()
      .meta({ description: 'ISO 8601, UTC. Reset when an invitation is renewed.' }),
  })
  .meta({ id: 'TeamMember' });

export const teamListSchema = z
  .object({ items: z.array(teamMemberSchema) })
  .meta({ id: 'TeamList' });

export const projectTeamParamSchema = z.object({
  id: z.string().meta({ description: 'The project id (UUID)' }),
});

export type TeamMember = z.infer<typeof teamMemberSchema>;
export type TeamList = z.infer<typeof teamListSchema>;

// ----------------------------------------------------------------- requests

export const inviteMemberSchema = z
  .strictObject({
    userId: z
      .string()
      .min(1)
      .max(36)
      .meta({ description: 'The account to invite (a public profile).' }),
    role: nullableText('project_team_members.role')
      .default(null)
      .meta({ description: 'Shown on the team list; optional.' }),
  })
  .meta({ id: 'InviteMemberRequest' });

export const addExternalMemberSchema = z
  .strictObject({
    name: requiredText('project_team_members.name'),
    role: nullableText('project_team_members.role').default(null),
  })
  .meta({
    id: 'AddExternalMemberRequest',
    description: 'A teammate without an account: a name only. No invitation, no notification.',
  });

export const memberParamsSchema = z.object({
  id: z.string().meta({ description: 'The project id (UUID)' }),
  memberId: z.string().meta({ description: 'The membership id (UUID)' }),
});

export const lookupQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .meta({ description: 'The start of a name; at least 3 characters.' }),
});

export const lookupResultSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        headline: z.string().nullable(),
        avatarUrl: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'UserLookupResult' });

export type InviteMember = z.output<typeof inviteMemberSchema>;
export type AddExternalMember = z.output<typeof addExternalMemberSchema>;
