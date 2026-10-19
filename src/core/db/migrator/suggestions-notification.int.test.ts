import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchDatabase, type ScratchDatabase, testConfig } from '../../../testing/database.js';
import { createPool } from '../pool.js';
import { loadMigrations } from './files.js';
import { type Connection } from './registry.js';
import { down, up } from './runner.js';
import { dumpSchema } from './schema-dump.js';

/**
 * Migration 0011 (docs/modules/m7/plan.md §6.6e) adds one notification type. It is
 * additive: existing notifications are kept, it applies twice with nothing left, and
 * its down removes the notifications of the type it added and gives the schema back
 * identically.
 */
describe('0011_suggestions_notification', () => {
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
  const insert = (id: string, type: string) =>
    conn.query(
      `INSERT INTO notifications (id, user_id, type, title) VALUES ('${id}', 'u1', '${type}', 'T')`,
    );

  it('keeps the notifications that exist, and takes the new type only after it', async () => {
    const o = await opts();
    await up(conn, o, '0010_deleted_subjects');
    await conn.query(`INSERT INTO users (id, auth0_id, name) VALUES ('u1', 'auth0|m', 'Kept')`);
    await insert('n1', 'team_left');
    await expect(insert('n2', 'suggestions_available')).rejects.toMatchObject({ errno: 1265 });

    expect(await up(conn, o, '0011_suggestions_notification')).toEqual([
      '0011_suggestions_notification',
    ]);
    await insert('n3', 'suggestions_available');
    const [rows] = await conn.query('SELECT id, type FROM notifications ORDER BY id');
    expect(rows).toEqual([
      { id: 'n1', type: 'team_left' },
      { id: 'n3', type: 'suggestions_available' },
    ]);
  });

  it('applies twice with nothing left; down drops its own rows only, and down then up gives the same schema', async () => {
    const o = await opts();
    await up(conn, o, '0011_suggestions_notification');
    expect(await up(conn, o, '0011_suggestions_notification')).toEqual([]);
    const first = await dumpSchema(conn);
    expect(first).toContain('suggestions_available');

    await conn.query(`INSERT INTO users (id, auth0_id, name) VALUES ('u1', 'auth0|m', 'U')`);
    await insert('n1', 'general');
    await insert('n2', 'suggestions_available');

    expect(await down(conn, o)).toEqual(['0011_suggestions_notification']);
    expect(await dumpSchema(conn)).not.toContain('suggestions_available');
    const [rows] = await conn.query('SELECT id, type FROM notifications');
    expect(rows).toEqual([{ id: 'n1', type: 'general' }]);

    await up(conn, o, '0011_suggestions_notification');
    expect(await dumpSchema(conn)).toBe(first);
  });
});
