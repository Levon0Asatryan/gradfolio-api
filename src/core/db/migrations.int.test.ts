import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchDatabase, type ScratchDatabase } from '../../testing/database.js';
import { loadMigrations } from './migrator/files.js';
import { down, MigrationError, up } from './migrator/runner.js';

/**
 * 0003_project_terms on data written before its rules existed: unnormalized
 * spellings, case-insensitive duplicates, blanks. Each test starts from an
 * empty scratch database at 0002.
 */
describe('0003_project_terms on legacy data', () => {
  let db: ScratchDatabase;
  let conn: Connection;
  const opts = async () => ({
    migrations: await loadMigrations(),
    report: () => undefined,
    lockTimeoutS: 5,
  });
  const rows = async (q: string, params: unknown[] = []) =>
    (await conn.query<RowDataPacket[]>(q, params))[0];

  beforeEach(async () => {
    db = await scratchDatabase();
    conn = await createConnection({ uri: db.url });
    await up(conn, await opts(), '0002_value_checks');
    await conn.query(
      "INSERT INTO users (id, auth0_id, name) VALUES ('u1', 'a|1', 'Ani'), ('u2', 'a|2', 'Mher')",
    );
  });

  afterEach(async () => {
    await conn.end();
    await db.drop();
  });

  async function legacyProject(id: string, technologies: string[], tags: string[] = []) {
    await conn.query(
      'INSERT INTO projects (id, user_id, title, technologies, tags) VALUES (?, ?, ?, ?, ?)',
      [id, 'u1', id, JSON.stringify(technologies), JSON.stringify(tags)],
    );
  }

  async function legacySkills(userId: string, names: string[]) {
    for (const [i, name] of names.entries()) {
      await conn.query(
        'INSERT INTO user_skills (id, user_id, skill_name, sort_order) VALUES (UUID(), ?, ?, ?)',
        [userId, name, i],
      );
    }
  }

  it('normalizes legacy spellings, so one term has one key and one spelling', async () => {
    await legacySkills('u1', ['React  Native', 'Go']);
    await legacyProject('p1', [' react   native', 'go', 'Kotlin'], ['  mobile ', 'MOBILE']);

    await up(conn, await opts());

    const terms = await rows('SELECT CAST(name AS BINARY) AS spelling FROM terms ORDER BY name');
    expect(terms.map((r) => String(r.spelling))).toEqual([
      'Go',
      'Kotlin',
      'mobile',
      'React Native',
    ]);
    const techs = await rows(
      "SELECT CAST(name AS BINARY) AS spelling FROM project_technologies WHERE project_id = 'p1' ORDER BY sort_order",
    );
    // Skills registered first, so their spelling won.
    expect(techs.map((r) => String(r.spelling))).toEqual(['React Native', 'Go', 'Kotlin']);
    const tags = await rows(
      "SELECT CAST(name AS BINARY) AS spelling FROM project_tags WHERE project_id = 'p1'",
    );
    expect(tags.map((r) => String(r.spelling))).toEqual(['mobile']);
  });

  it('merges case-insensitive duplicate skills, keeping the first, before the UNIQUE key', async () => {
    await legacySkills('u1', ['React', 'Go', 'react ', 'REACT', '   ']);
    await legacySkills('u2', ['react']);

    await up(conn, await opts());

    const u1 = await rows(
      "SELECT CAST(skill_name AS BINARY) AS spelling, sort_order FROM user_skills WHERE user_id = 'u1' ORDER BY sort_order",
    );
    expect(u1.map((r): unknown[] => [String(r.spelling), r.sort_order])).toEqual([
      ['React', 0],
      ['Go', 1],
    ]);
    const u2 = await rows(
      "SELECT CAST(skill_name AS BINARY) AS spelling FROM user_skills WHERE user_id = 'u2'",
    );
    expect(u2.map((r) => String(r.spelling))).toEqual(['React']);
  });

  it('rolls back to JSON columns in their stored order', async () => {
    await legacyProject('p1', ['Rust', 'Go', 'C#'], ['cli']);
    await legacyProject('p2', [], []);
    await up(conn, await opts());

    await down(conn, await opts(), { to: '0002_value_checks' });

    const projects = await rows('SELECT id, technologies, tags FROM projects ORDER BY id');
    expect(projects.map((r): unknown[] => [r.id, r.technologies, r.tags])).toEqual([
      ['p1', ['Rust', 'Go', 'C#'], ['cli']],
      ['p2', null, null],
    ]);
  });

  it('stops, losing nothing, when a legacy name is longer than the new column', async () => {
    await legacyProject('p1', ['x'.repeat(300)]);

    const error = await up(conn, await opts()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationError);
    expect(String((error as Error).message)).toMatch(
      /0003_project_terms \(up\) step \d+ failed: .*too long/i,
    );
    // The JSON column still holds it: nothing was dropped.
    const [project] = await rows(
      "SELECT JSON_LENGTH(technologies) AS n FROM projects WHERE id = 'p1'",
    );
    expect(project?.n).toBe(1);
  });
});
