import { sql } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../../testing/database.js';
import { perfSeed, perfSeedRefusal } from './perf-seed.js';

describe('perfSeed', () => {
  const db = testDatabase();

  beforeEach(async () => {
    await db.deleteFrom('users').execute();
    await db.deleteFrom('terms').execute();
  });

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

  const count = async (table: string) =>
    Number(
      (await sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql.table(table)}`.execute(db)).rows[0]!
        .n,
    );

  it('never makes a project’s owner one of its team members', async () => {
    await perfSeed(db, { users: 40, projectsPerUser: 3 });
    expect(await count('project_team_members')).toBeGreaterThan(0);
    const { rows } = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM project_team_members m
        JOIN projects p ON p.id = m.project_id WHERE m.user_id = p.user_id`.execute(db);
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('writes the planned activities, in shapes the application writes, five per user', async () => {
    await perfSeed(db, { users: 20, projectsPerUser: 2 });
    expect(await count('activities')).toBe(100);
    const { rows } = await sql<{ k: string; n: number }>`
      SELECT translation_key AS k, COUNT(*) AS n FROM activities GROUP BY translation_key`.execute(
      db,
    );
    expect(rows.map((r) => r.k).toSorted()).toEqual(['newSkill', 'projectCreated']);
    const projectParams = await sql<{ id: string | null }>`
      SELECT JSON_UNQUOTE(JSON_EXTRACT(translation_params, '$.projectId')) AS id
        FROM activities WHERE translation_key = 'projectCreated'`.execute(db);
    const known = new Set(
      (await sql<{ id: string }>`SELECT id FROM projects`.execute(db)).rows.map((r) => r.id),
    );
    for (const r of projectParams.rows) expect(known.has(r.id!)).toBe(true);
  });

  it('is atomic: a failure on the last table leaves no rows, so a retry starts clean', async () => {
    // Activities are inserted last, after every other table: refusing them fails the
    // load there, with every earlier statement already executed.
    const failing = db.withPlugin({
      transformQuery: (args) => {
        const node = args.node as {
          kind: string;
          into?: { table?: { identifier?: { name?: string } } };
        };
        if (
          node.kind === 'InsertQueryNode' &&
          node.into?.table?.identifier?.name === 'activities'
        ) {
          throw new Error('forced failure on the last table');
        }
        return args.node;
      },
      transformResult: (args) => Promise.resolve(args.result),
    });
    await expect(perfSeed(failing, { users: 10, projectsPerUser: 1 })).rejects.toThrow(/forced/);
    for (const table of ['users', 'education', 'user_skills', 'projects', 'terms', 'activities']) {
      expect(await count(table), table).toBe(0);
    }
    // and the retry converges
    expect(await perfSeed(db, { users: 10, projectsPerUser: 1 })).toEqual({
      users: 10,
      projects: 10,
    });
  });

  it.each([
    ['mysql://u:p@127.0.0.1:3307/gradfolio_test', /integration test database/],
    ['mysql://u:p@127.0.0.1:3307/gradfolio-test', /integration test database/],
    ['mysql://u:p@127.0.0.1:3307/test', /integration test database/],
    ['mysql://u:p@db/gradfolio_prod', /production/],
    ['mysql://u:p@db/', /no database/],
    ['not a url', /not a URL/],
  ])('refuses %s', (url, why) => {
    expect(perfSeedRefusal(url)).toMatch(why);
  });

  it.each(['mysql://u:p@127.0.0.1:3307/gradfolio', 'mysql://u:p@127.0.0.1:3307/gradfolio_perf'])(
    'accepts %s',
    (url) => {
      expect(perfSeedRefusal(url)).toBeUndefined();
    },
  );
});
