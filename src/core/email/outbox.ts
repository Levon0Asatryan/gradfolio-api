import { sql, type Transaction } from 'kysely';
import type { AppConfig } from '../config/schema.js';
import type { DB } from '../db/types.generated.js';

/** Cancel work before dispatch; an in-flight provider outcome must remain recordable. */
export async function cancelInviteEmail(
  trx: Transaction<DB>,
  projectId: string,
  recipientId: string,
): Promise<void> {
  await trx
    .updateTable('emailOutbox')
    .set({ status: 'canceled', leaseToken: null, leaseExpiresAt: null })
    .where('projectId', '=', projectId)
    .where('recipientUserId', '=', recipientId)
    .where('status', 'in', ['pending', 'leased'])
    .execute();
}

/** Caller holds the project lock. This write rolls back with the invitation. */
export async function enqueueInviteEmail(
  trx: Transaction<DB>,
  event: {
    id: string;
    recipientId: string;
    projectId: string;
    actorName: string;
    projectTitle: string;
  },
  cfg: Pick<AppConfig, 'EMAIL_INVITE_COOLDOWN_S'>,
): Promise<void> {
  const recipient = await trx
    .selectFrom('users')
    .select([
      'email',
      'emailVerified',
      'emailSuppressed',
      'teamInviteEmailEnabled',
      'preferredLanguage',
    ])
    .where('id', '=', event.recipientId)
    .executeTakeFirst();
  if (
    !recipient?.email ||
    !recipient.emailVerified ||
    recipient.emailSuppressed ||
    !recipient.teamInviteEmailEnabled
  )
    return;
  const recent = await trx
    .selectFrom('emailOutbox')
    .select('id')
    .where('projectId', '=', event.projectId)
    .where('recipientUserId', '=', event.recipientId)
    .where(
      'createdAt',
      '>',
      sql<Date>`DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ${cfg.EMAIL_INVITE_COOLDOWN_S} SECOND)`,
    )
    .limit(1)
    .executeTakeFirst();
  if (recent) return;
  await trx
    .insertInto('emailOutbox')
    .values({
      id: event.id,
      recipientUserId: event.recipientId,
      projectId: event.projectId,
      actorName: event.actorName,
      projectTitle: event.projectTitle,
      language: recipient.preferredLanguage,
    })
    .execute();
}
