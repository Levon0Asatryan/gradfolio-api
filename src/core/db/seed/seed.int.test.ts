import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { testDatabase } from '../../../testing/database.js';
import { createUser } from '../../../testing/factories.js';
import { SEED_PROJECTS, SEED_USERS } from './data.js';
import { seed } from './seed.js';

describe('seed', () => {
  const db = testDatabase();

  const counts = async () => {
    const tables = [
      'users',
      'education',
      'experience',
      'certifications',
      'user_skills',
      'projects',
      'project_technologies',
      'project_tags',
      'project_attachments',
      'project_team_members',
      'integrations',
      'activities',
      'notifications',
    ];
    const result: Record<string, number> = {};
    for (const t of tables) {
      const r = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql.table(t)}`.execute(db);
      result[t] = Number(r.rows[0]?.n);
    }
    return result;
  };

  /**
   * Every seed-owned row, by content: all columns except the generated child
   * ids and the timestamps the database stamps on insert, sorted. Equal
   * snapshots mean a reload wrote the same data, not just as many rows.
   */
  const snapshot = async () => {
    const unstable = new Set(['id', 'created_at', 'updated_at']);
    const result: Record<string, string[]> = {};
    for (const table of Object.keys(await counts())) {
      const columns = await sql<{ name: string }>`
        SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ${table}
         ORDER BY ordinal_position`.execute(db);
      // users.id is a fixed seed id, so it stays; every other id is generated.
      const kept = columns.rows
        .map((c) => c.name)
        .filter((c) => !unstable.has(c) || (table === 'users' && c === 'id'));
      const rows = await sql<Record<string, unknown>>`
        SELECT ${sql.join(kept.map((c) => sql.ref(c)))} FROM ${sql.table(table)}`.execute(db);
      result[table] = rows.rows.map((r) => JSON.stringify(kept.map((c) => r[c]))).sort();
    }
    return result;
  };

  it('loads on the migrated schema, and loading again gives the same rows', async () => {
    const bystander = await createUser(db, { name: 'not part of the seed' });
    await seed(db);
    const first = await counts();
    expect(first).toEqual({
      users: 7,
      education: 5,
      experience: 3,
      certifications: 3,
      user_skills: 23,
      projects: 8,
      project_technologies: 23,
      project_tags: 14,
      project_attachments: 4,
      project_team_members: 6,
      integrations: 2,
      activities: 5,
      notifications: 4,
    });
    const before = await snapshot();
    await seed(db);
    expect(await counts()).toEqual(first);
    expect(await snapshot()).toEqual(before);
    // Only the seed's own rows are replaced.
    expect(
      await db.selectFrom('users').select('id').where('id', '=', bystander.id).execute(),
    ).toHaveLength(1);
  });

  it('builds every notification link from a real project id (S12)', async () => {
    await seed(db);
    const rows = await sql<{ link: string; resolves: number }>`
      SELECT n.link, (p.id IS NOT NULL AND n.link = CONCAT('/projects/', p.id)) AS resolves
        FROM notifications n LEFT JOIN projects p ON p.id = n.reference_id`.execute(db);
    expect(rows.rows.length).toBe(4);
    expect(rows.rows.every((r) => Number(r.resolves) === 1)).toBe(true);
  });

  it('never lists an owner as a member of their own project (S11)', async () => {
    await seed(db);
    const owners = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM project_team_members m JOIN projects p ON p.id = m.project_id
       WHERE m.user_id = p.user_id`.execute(db);
    expect(Number(owners.rows[0]?.n)).toBe(0);
  });

  it('includes a GitHub draft, a private project and a private profile', async () => {
    await seed(db);
    const draft = await db
      .selectFrom('projects')
      .select(['source', 'isDraft', 'githubRepoId', 'repoStars'])
      .where('id', '=', SEED_PROJECTS.importedCli)
      .executeTakeFirstOrThrow();
    expect(draft).toEqual({
      source: 'github',
      isDraft: true,
      githubRepoId: 812345678,
      repoStars: 42,
    });
    const privateProject = await db
      .selectFrom('projects')
      .select('isPublic')
      .where('id', '=', SEED_PROJECTS.privateThesis)
      .executeTakeFirstOrThrow();
    expect(privateProject.isPublic).toBe(false);
    const privateUser = await db
      .selectFrom('users')
      .select('isPublic')
      .where('id', '=', SEED_USERS.narek)
      .executeTakeFirstOrThrow();
    expect(privateUser.isPublic).toBe(false);
  });
});
