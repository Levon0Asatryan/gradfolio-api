import type { Database } from '../../../core/db/database.js';

/**
 * Reads of the ordered profile sections, in the order the owner chose
 * (`sort_order`, then id so ties are stable). Always scoped by `user_id`.
 */

export async function listEducation(db: Database, userId: string) {
  const rows = await db
    .selectFrom('education')
    .select([
      'id',
      'institution',
      'degree',
      'field',
      'startYear',
      'endYear',
      'description',
      'highlights',
    ])
    .where('userId', '=', userId)
    .orderBy('sortOrder')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({ ...r, highlights: r.highlights ?? [] }));
}

export async function listExperience(db: Database, userId: string) {
  const rows = await db
    .selectFrom('experience')
    .select(['id', 'title', 'organization', 'start', 'end', 'summary', 'achievements', 'skills'])
    .where('userId', '=', userId)
    .orderBy('sortOrder')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({
    ...r,
    achievements: r.achievements ?? [],
    skills: r.skills ?? [],
  }));
}

export function listCertifications(db: Database, userId: string) {
  return db
    .selectFrom('certifications')
    .select(['id', 'name', 'issuer', 'date', 'credentialUrl'])
    .where('userId', '=', userId)
    .orderBy('sortOrder')
    .orderBy('id')
    .execute();
}

export async function listSkills(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('userSkills')
    .select('skillName')
    .where('userId', '=', userId)
    .orderBy('sortOrder')
    .orderBy('skillName')
    .execute();
  return rows.map((r) => r.skillName);
}
