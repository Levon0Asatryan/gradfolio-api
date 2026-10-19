import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchDatabase, type ScratchDatabase, testConfig } from '../../../testing/database.js';
import { createPool } from '../pool.js';
import { loadMigrations } from './files.js';
import { type Connection } from './registry.js';
import { down, up } from './runner.js';
import { dumpSchema } from './schema-dump.js';

/**
 * Migration 0010 (docs/modules/m7/plan.md §2.8, M7-T23) is additive: rows that exist
 * before it are kept, it applies twice with nothing left, and its down gives the
 * schema back identically.
 */
describe('0010_deleted_subjects', () => {
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

  it('keeps a user row, and adds an empty table', async () => {
    const o = await opts();
    await up(conn, o, '0009_suggestions');
    await conn.query(`INSERT INTO users (id, auth0_id, name) VALUES ('u1', 'auth0|m', 'Kept')`);
    expect(await up(conn, o, '0010_deleted_subjects')).toEqual(['0010_deleted_subjects']);
    const [users] = await conn.query('SELECT name FROM users');
    expect(users).toEqual([{ name: 'Kept' }]);
    const [rows] = await conn.query('SELECT COUNT(*) AS n FROM deleted_subjects');
    expect(rows).toEqual([{ n: 0 }]);
  });

  it('applies twice with nothing left, and down then up gives the same schema', async () => {
    const o = await opts();
    await up(conn, o, '0010_deleted_subjects');
    expect(await up(conn, o, '0010_deleted_subjects')).toEqual([]);
    const first = await dumpSchema(conn);
    expect(first).toContain('CREATE TABLE `deleted_subjects`');

    expect(await down(conn, o)).toEqual(['0010_deleted_subjects']);
    expect(await dumpSchema(conn)).not.toContain('deleted_subjects');

    await up(conn, o, '0010_deleted_subjects');
    expect(await dumpSchema(conn)).toBe(first);
  });

  it('one entry per subject', async () => {
    const o = await opts();
    await up(conn, o);
    const insert = () =>
      conn.query(`INSERT INTO deleted_subjects (auth0_id, expires_at) VALUES ('auth0|x', NOW())`);
    await insert();
    await expect(insert()).rejects.toMatchObject({ errno: 1062 });
  });
});
