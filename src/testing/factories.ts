import type { Insertable, Selectable } from 'kysely';
import type { Database } from '../core/db/database.js';
import { newId } from '../core/db/ids.js';
import { toJsonColumn } from '../core/db/json.js';
import { setProjectTerms, setUserSkills } from '../core/db/terms.js';
import { inTransaction } from '../core/db/transaction.js';
import type { Projects, Users } from '../core/db/types.generated.js';
import { linkList, stringList } from '../core/validation/json-shapes.js';

/**
 * Rows for integration tests, written through the same query layer and rules
 * as the application: ids generated here, JSON through `toJsonColumn`, terms
 * canonicalized. Each returns what was stored, read back.
 */

let counter = 0;
const unique = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export async function createUser(
  db: Database,
  overrides: Partial<Insertable<Users>> = {},
): Promise<Selectable<Users>> {
  const id = overrides.id ?? newId();
  await db
    .insertInto('users')
    .values({ id, auth0Id: `test|${unique()}`, name: 'Test Student', ...overrides })
    .execute();
  return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

export interface Profile {
  user: Selectable<Users>;
  skills: string[];
}

/** A user with one entry in every profile section, and skills. */
export async function createProfile(
  db: Database,
  {
    skills = ['TypeScript', 'MySQL'],
    ...user
  }: Partial<Insertable<Users>> & { skills?: string[] } = {},
): Promise<Profile> {
  const created = await createUser(db, user);
  const userId = created.id;
  const stored = await inTransaction(db, async (trx) => {
    await trx
      .insertInto('education')
      .values({
        id: newId(),
        userId,
        institution: 'National Polytechnic University of Armenia',
        degree: 'Bachelor of Science',
        field: 'Computer Science',
        startYear: 2022,
        highlights: toJsonColumn(stringList({ maxItems: 20 }), ['Dean’s list']),
      })
      .execute();
    await trx
      .insertInto('experience')
      .values({
        id: newId(),
        userId,
        title: 'Intern',
        organization: 'Picsart',
        start: '2024-06',
        end: '2024-09',
        summary: 'Built things.',
        achievements: toJsonColumn(stringList({ maxItems: 20 }), ['Shipped a feature']),
        skills: toJsonColumn(stringList({ maxItems: 50 }), ['TypeScript']),
      })
      .execute();
    await trx
      .insertInto('certifications')
      .values({
        id: newId(),
        userId,
        name: 'AWS Cloud Practitioner',
        issuer: 'AWS',
        date: '2025-01',
      })
      .execute();
    return setUserSkills(trx, userId, skills);
  });
  return { user: created, skills: stored };
}

export interface CreatedProject {
  project: Selectable<Projects>;
  technologies: string[];
  tags: string[];
}

export async function createProject(
  db: Database,
  owner: { id: string },
  {
    technologies = ['TypeScript'],
    tags = [],
    links = [],
    attachments = [],
    ...project
  }: Omit<Partial<Insertable<Projects>>, 'links'> & {
    technologies?: string[];
    tags?: string[];
    links?: { label: string; url: string }[];
    attachments?: { type: 'image' | 'video' | 'pdf' | 'link'; url: string; title?: string }[];
  } = {},
): Promise<CreatedProject> {
  const id = project.id ?? newId();
  const stored = await inTransaction(db, async (trx) => {
    await trx
      .insertInto('projects')
      .values({
        id,
        userId: owner.id,
        title: 'Test Project',
        links: toJsonColumn(linkList({ maxItems: 20 }), links),
        ...project,
      })
      .execute();
    for (const [sortOrder, a] of attachments.entries()) {
      await trx
        .insertInto('projectAttachments')
        .values({ id: newId(), projectId: id, ...a, sortOrder })
        .execute();
    }
    return {
      technologies: await setProjectTerms(trx, id, 'technologies', technologies),
      tags: await setProjectTerms(trx, id, 'tags', tags),
    };
  });
  const row = await db
    .selectFrom('projects')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return { project: row, ...stored };
}
