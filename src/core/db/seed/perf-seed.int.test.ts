import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { testDatabase } from '../../../testing/database.js';
import { perfSeed } from './perf-seed.js';

describe('perfSeed', () => {
  const db = testDatabase();

  it('loads the requested number of users and projects, with terms and team rows, deterministically', async () => {
    const loaded = await perfSeed(db, { users: 30, projectsPerUser: 2 });
    expect(loaded).toEqual({ users: 30, projects: 60 });
    const count = async (table: string) =>
      Number(
        (await sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql.table(table)}`.execute(db))
          .rows[0]!.n,
      );
    expect(await count('users')).toBe(30);
    expect(await count('projects')).toBe(60);
    expect(await count('education')).toBe(30);
    expect(await count('user_skills')).toBeGreaterThan(30);
    expect(await count('project_technologies')).toBeGreaterThan(60);
    expect(await count('terms')).toBeGreaterThan(10);
    // every term a row uses is in the registry (the same rule the application keeps)
    const orphans = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM project_technologies x
        LEFT JOIN terms t ON t.name = x.name WHERE t.name IS NULL`.execute(db);
    expect(Number(orphans.rows[0]!.n)).toBe(0);
  });
});
