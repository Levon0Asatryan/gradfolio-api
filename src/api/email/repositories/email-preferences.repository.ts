import type { Database } from '../../../core/db/database.js';
import type { EmailPreferencesPatch } from '../dto/email.dto.js';

export function findEmailPreferences(db: Database, userId: string) {
  return db
    .selectFrom('users')
    .select(['teamInviteEmailEnabled', 'preferredLanguage'])
    .where('id', '=', userId)
    .executeTakeFirst();
}

export function patchEmailPreferences(db: Database, userId: string, input: EmailPreferencesPatch) {
  return db
    .updateTable('users')
    .set({
      ...(input.teamInvitesEnabled !== undefined
        ? { teamInviteEmailEnabled: input.teamInvitesEnabled }
        : {}),
      ...(input.preferredLanguage !== undefined
        ? { preferredLanguage: input.preferredLanguage }
        : {}),
    })
    .where('id', '=', userId)
    .executeTakeFirst();
}

export function disableInvitationEmail(db: Database, userId: string) {
  return db
    .updateTable('users')
    .set({ teamInviteEmailEnabled: false })
    .where('id', '=', userId)
    .execute();
}
