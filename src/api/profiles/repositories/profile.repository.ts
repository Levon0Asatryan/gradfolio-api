import type { Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { DB } from '../../../core/db/types.generated.js';
import type { ProfileHeader, UpdateProfile } from '../dto/profile.dto.js';
import { visibleTo } from '../utils/visibility.js';

type Executor = Database | Transaction<DB>;

/**
 * The columns a profile read may select -- listed one by one, never
 * `selectAll()`: a column added to `users` later (a phone, a token) must be
 * opted in here before it can reach a public response (OWASP API3).
 */
const PROFILE_COLUMNS = [
  'users.id',
  'users.name',
  'users.headline',
  'users.bio',
  'users.location',
  'users.avatarUrl',
  'users.verified',
  'users.contactEmail',
  'users.isPublic',
  'users.github',
  'users.linkedin',
  'users.twitter',
  'users.website',
] as const;

/** The user's row if `viewerId` may read it (see `visibleTo`), else nothing. */
export function findVisibleUser(db: Executor, id: string, viewerId: string | undefined) {
  return db
    .selectFrom('users')
    .select(PROFILE_COLUMNS)
    .where('users.id', '=', id)
    .where((eb) => visibleTo(eb, viewerId))
    .executeTakeFirst();
}

export type ProfileUserRow = NonNullable<Awaited<ReturnType<typeof findVisibleUser>>>;

export function toHeader(row: ProfileUserRow): ProfileHeader {
  return {
    id: row.id,
    name: row.name,
    headline: row.headline,
    bio: row.bio,
    location: row.location,
    avatarUrl: row.avatarUrl,
    contactEmail: row.contactEmail,
    isPublic: row.isPublic,
    links: {
      github: row.github,
      linkedin: row.linkedin,
      twitter: row.twitter,
      website: row.website,
    },
  };
}

/**
 * Writes the fields in `patch` to the caller's own row. Returns the number of
 * rows matched: 0 means the account is gone (deleted after the guard resolved
 * it), which the service turns into 404. The pool counts matched rows, so a
 * patch that changes nothing still returns 1 (docs/m3-plan.md §4.3, P1).
 */
export async function updateHeader(
  db: Executor,
  userId: string,
  patch: UpdateProfile,
): Promise<number> {
  const { links, ...fields } = patch;
  const set = {
    ...fields,
    ...(links?.github !== undefined ? { github: links.github } : {}),
    ...(links?.linkedin !== undefined ? { linkedin: links.linkedin } : {}),
    ...(links?.twitter !== undefined ? { twitter: links.twitter } : {}),
    ...(links?.website !== undefined ? { website: links.website } : {}),
  };
  const result = await db.updateTable('users').set(set).where('id', '=', userId).executeTakeFirst();
  return Number(result.numUpdatedRows);
}
