import { z } from 'zod';

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
