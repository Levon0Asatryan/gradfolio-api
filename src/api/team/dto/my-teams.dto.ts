import { z } from 'zod';
import { teamMemberSchema } from './team.dto.js';

const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'Pass as this section’s cursor parameter; null on the last page.' }),
  });

const person = z.object({
  id: z.string().nullable().meta({
    description:
      'The account, for a profile link. null when their profile is not visible to the caller.',
  }),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});

const projectRef = z.object({ id: z.string(), title: z.string() });

export const ownedTeamSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    isPublic: z.boolean(),
    isDraft: z.boolean(),
    members: z.array(teamMemberSchema).meta({
      description: 'Every membership of the project, with its status. Never empty here.',
    }),
  })
  .meta({ id: 'OwnedTeam' });

export const memberTeamSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    isPublic: z.boolean(),
    role: z.string().nullable().meta({ description: 'The caller’s role on the team.' }),
    joinedAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
    owner: person,
    team: z
      .array(teamMemberSchema)
      .meta({ description: 'The accepted members, the caller included.' }),
  })
  .meta({ id: 'MemberTeam' });

export const incomingInviteSchema = z
  .object({
    id: z.string().meta({ description: 'The membership id.' }),
    project: projectRef.meta({
      description:
        'Only the title: a pending invitee does not read the project (answer with /projects/{id}/team/me/accept or reject).',
    }),
    role: z.string().nullable(),
    invitedAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
    invitedBy: person.omit({ avatarUrl: true }),
  })
  .meta({ id: 'IncomingInvite' });

export const outgoingInviteSchema = z
  .object({
    id: z.string().meta({
      description: 'The membership id, for cancelling (DELETE /projects/{id}/team/{memberId}).',
    }),
    project: projectRef,
    invitee: person,
    role: z.string().nullable(),
    invitedAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
  })
  .meta({ id: 'OutgoingInvite' });

export const myTeamsSchema = z
  .object({
    owned: page(ownedTeamSchema).meta({
      description: 'Projects the caller owns that have any membership, newest first.',
    }),
    member: page(memberTeamSchema).meta({
      description:
        'Projects the caller is an accepted member of (never a draft), newest join first.',
    }),
    incoming: page(incomingInviteSchema).meta({
      description: 'Invitations waiting for the caller’s answer.',
    }),
    outgoing: page(outgoingInviteSchema).meta({
      description: 'Invitations the caller sent that are still pending.',
    }),
  })
  .meta({
    id: 'MyTeams',
    description:
      'Four lists in one call. Each pages on its own cursor: pass only the cursor of the list you are extending; the others start from their first page.',
  });

/** Unknown query keys are a 400, like everywhere else. */
export const myTeamsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).optional().meta({
    description: 'Page size of every list; at most TEAMS_PAGE_MAX (50); 20 when omitted.',
  }),
  ownedCursor: z.string().min(1).max(600).optional(),
  memberCursor: z.string().min(1).max(600).optional(),
  incomingCursor: z.string().min(1).max(600).optional(),
  outgoingCursor: z.string().min(1).max(600).optional(),
});

export type MyTeams = z.infer<typeof myTeamsSchema>;
export type MyTeamsQuery = z.output<typeof myTeamsQuerySchema>;
