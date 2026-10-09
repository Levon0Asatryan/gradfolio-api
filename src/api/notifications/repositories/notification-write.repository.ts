import type { Transaction } from 'kysely';
import { newId } from '../../../core/db/ids.js';
import { toJsonColumn } from '../../../core/db/json.js';
import type { DB } from '../../../core/db/types.generated.js';
import { notificationParams } from '../../../core/validation/json-shapes.js';

export type TeamNotificationType = 'team_invite' | 'team_accepted' | 'team_rejected' | 'team_left';

/** The stored fallback text (English); clients render `type` + `params` in the reader's language. */
const TITLES: Record<TeamNotificationType, string> = {
  team_invite: 'Team invitation',
  team_accepted: 'Invitation accepted',
  team_rejected: 'Invitation declined',
  team_left: 'A teammate left',
};

export interface TeamNotification {
  /** The recipient. */
  userId: string;
  type: TeamNotificationType;
  actor: { id: string; name: string };
  project: { id: string; title: string };
  role?: string | null;
}

/**
 * Writes a notification **inside the caller's transaction**: it commits or
 * rolls back with the change it reports (docs/m5-plan.md §5). Only team
 * services call this; there is no way to create one over HTTP. The link is
 * never stored: it is computed when the notification is read (S12).
 */
export async function insertTeamNotification(
  trx: Transaction<DB>,
  n: TeamNotification,
): Promise<void> {
  await trx
    .insertInto('notifications')
    .values({
      id: newId(),
      userId: n.userId,
      type: n.type,
      title: TITLES[n.type],
      referenceId: n.project.id,
      referenceType: 'project',
      params: toJsonColumn(notificationParams, {
        actorId: n.actor.id,
        actorName: n.actor.name,
        projectId: n.project.id,
        projectTitle: n.project.title,
        role: n.role ?? null,
      }),
    })
    .execute();
}
