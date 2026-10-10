import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchDatabase, type ScratchDatabase, testConfig } from '../../../testing/database.js';
import { createPool } from '../pool.js';
import { loadMigrations } from './files.js';
import { type Connection } from './registry.js';
import { down, up } from './runner.js';
import { dumpSchema } from './schema-dump.js';

/**
 * Migration 0007 (docs/m6-plan.md §5) is additive: applied to a database that
 * already holds data it adds seven indexes and changes nothing else, so the
 * previous revision keeps serving while it builds.
 */
describe('0007_discovery_indexes', () => {
  let db: ScratchDatabase;
  let pool: ReturnType<typeof createPool>;
  let conn: Connection & { release: () => void };

  beforeEach(async () => {
    db = await scratchDatabase();
    pool = createPool({ ...testConfig(), DATABASE_URL: db.url, DATABASE_POOL_MAX: 2 });
    conn = await pool.getConnection();
  });
  afterEach(async () => {
    conn.release();
    await pool.end();
    await db.drop();
  });

  const opts = async () => ({
    migrations: await loadMigrations(),
    report: () => undefined,
    lockTimeoutS: 5,
  });

  it('adds only indexes, leaves every row alone, and the schema before and after differ in nothing else', async () => {
    const o = await opts();
    await up(conn, o, '0006_team_notifications');
    await conn.query(
      "INSERT INTO users (id, auth0_id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'auth0|m', 'Migrated')",
    );
    await conn.query(
      "INSERT INTO projects (id, user_id, title) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Kept')",
    );
    const before = await dumpSchema(conn);

    await up(conn, o);
    const after = await dumpSchema(conn);

    const lines = (s: string) => s.split('\n').map((l) => l.trim().replace(/,$/, ''));
    const b = new Set(lines(before));
    const added = lines(after).filter((l) => !b.has(l));
    expect(added.filter((l) => !/^(KEY|FULLTEXT KEY) /.test(l))).toEqual([]);
    expect(added.map((l) => /^KEY `(\w+)`/.exec(l)?.[1]).toSorted()).toEqual([
      'idx_education_end_year',
      'idx_education_field',
      'idx_education_institution',
      'idx_projects_browse',
      'idx_projects_browse_category',
      'idx_projects_browse_updated',
      'idx_users_browse',
    ]);
    expect(lines(before).filter((l) => !new Set(lines(after)).has(l))).toEqual([]);

    const [users] = await conn.query('SELECT name FROM users');
    const [projects] = await conn.query('SELECT title FROM projects');
    expect(users).toEqual([{ name: 'Migrated' }]);
    expect(projects).toEqual([{ title: 'Kept' }]);
  });

  it('applies twice with nothing left, and down then up gives the same schema', async () => {
    const o = await opts();
    expect(await up(conn, o)).toContain('0007_discovery_indexes');
    expect(await up(conn, o)).toEqual([]);
    const first = await dumpSchema(conn);
    expect(await down(conn, o)).toEqual(['0007_discovery_indexes']);
    expect(await dumpSchema(conn)).not.toBe(first);
    await up(conn, o);
    expect(await dumpSchema(conn)).toBe(first);
  });
});
