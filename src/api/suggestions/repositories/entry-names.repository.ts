import type { Transaction } from 'kysely';
import type { DB } from '../../../core/db/types.generated.js';

/** The institutions and organisations already on the caller's profile (names only). */
export async function heldEntries(
  trx: Transaction<DB>,
  userId: string,
): Promise<{ institutions: string[]; organizations: string[] }> {
  const [education, experience] = await Promise.all([
    trx.selectFrom('education').select('institution').where('userId', '=', userId).execute(),
    trx.selectFrom('experience').select('organization').where('userId', '=', userId).execute(),
  ]);
  return {
    institutions: education.map((r) => r.institution),
    organizations: experience.map((r) => r.organization),
  };
}
