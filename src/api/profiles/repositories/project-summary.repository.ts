import type { Database } from '../../../core/db/database.js';
import type { ProfileProject } from '../dto/profile.dto.js';
import { termsOf } from '../../projects/repositories/project-terms.repository.js';

const SUMMARY_COLUMNS = [
  'projects.id',
  'projects.title',
  'projects.summary',
  'projects.category',
  'projects.status',
  'projects.heroImageUrl',
  'projects.isPublic',
  'projects.isDraft',
  'projects.createdAt',
] as const;

/**
 * The projects shown on `userId`'s profile, newest first, at most `limit`:
 * their own, and those they are an *accepted* team member of.
 *
 * Everyone sees public, published projects only. The profile's owner also
 * sees their own private and draft ones. A project they merely belong to stays
 * public-only until the team model (Q4, M5) says members may see more. The
 * predicate is in the SQL, so a private project never leaves the database for
 * a caller who may not see it.
 */
export async function listProfileProjects(
  db: Database,
  userId: string,
  { viewerIsOwner, limit }: { viewerIsOwner: boolean; limit: number },
): Promise<ProfileProject[]> {
  const own = await db
    .selectFrom('projects')
    .select(SUMMARY_COLUMNS)
    .where('projects.userId', '=', userId)
    .$if(!viewerIsOwner, (qb) =>
      qb.where('projects.isPublic', '=', true).where('projects.isDraft', '=', false),
    )
    .orderBy('projects.createdAt', 'desc')
    .orderBy('projects.id')
    .limit(limit)
    .execute();

  const member = await db
    .selectFrom('projects')
    .innerJoin('projectTeamMembers as m', 'm.projectId', 'projects.id')
    .select(SUMMARY_COLUMNS)
    .where('m.userId', '=', userId)
    .where('m.status', '=', 'accepted')
    .where('projects.userId', '<>', userId)
    .where('projects.isPublic', '=', true)
    .where('projects.isDraft', '=', false)
    .orderBy('projects.createdAt', 'desc')
    .orderBy('projects.id')
    .limit(limit)
    .execute();

  const merged = [
    ...own.map((p) => ({ ...p, role: 'owner' as const })),
    ...member.map((p) => ({ ...p, role: 'member' as const })),
  ]
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, limit);

  const tags = await termsOf(
    db,
    'projectTags',
    merged.map((p) => p.id),
  );
  return merged.map(({ createdAt: _createdAt, ...p }) => ({ ...p, tags: tags.get(p.id) ?? [] }));
}
