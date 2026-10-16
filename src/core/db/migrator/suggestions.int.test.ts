import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchDatabase, type ScratchDatabase, testConfig } from '../../../testing/database.js';
import { createPool } from '../pool.js';
import { loadMigrations } from './files.js';
import { type Connection } from './registry.js';
import { down, up } from './runner.js';
import { dumpSchema } from './schema-dump.js';

/**
 * Migration 0009 (docs/m7-plan.md §6.4) is additive: rows that exist before it
 * are kept, it applies twice with nothing left, and its down gives the schema
 * back identically.
 */
describe('0009_suggestions', () => {
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

  it('keeps an integration row, and gives it the new columns empty', async () => {
    const o = await opts();
    await up(conn, o, '0008_github_connect');
    await conn.query(`INSERT INTO users (id, auth0_id, name) VALUES ('u1', 'auth0|m', 'Kept')`);
    await conn.query(
      `INSERT INTO integrations (id, user_id, integration_type, status, external_user_id, external_login)
       VALUES ('a', 'u1', 'github', 'connected', '42', 'kept-login')`,
    );
    expect(await up(conn, o)).toEqual(['0009_suggestions']);
    const [rows] = await conn.query(
      'SELECT status, external_login, suggestions_polled_at, profile_etag, profile_snapshot FROM integrations',
    );
    expect(rows).toEqual([
      {
        status: 'connected',
        external_login: 'kept-login',
        suggestions_polled_at: null,
        profile_etag: null,
        profile_snapshot: null,
      },
    ]);
  });

  it('applies twice with nothing left, and down then up gives the same schema', async () => {
    const o = await opts();
    await up(conn, o);
    expect(await up(conn, o)).toEqual([]);
    const first = await dumpSchema(conn);
    expect(first).toContain('CREATE TABLE `suggestions`');
    expect(first).toContain('uq_suggestions_user_key');

    expect(await down(conn, o)).toEqual(['0009_suggestions']);
    const reverted = await dumpSchema(conn);
    expect(reverted).not.toContain('suggestions');
    expect(reverted).not.toContain('profile_etag');

    await up(conn, o);
    expect(await dumpSchema(conn)).toBe(first);
  });

  it('one row per (user, key), and a payload that is not an object is refused', async () => {
    const o = await opts();
    await up(conn, o);
    await conn.query(`INSERT INTO users (id, auth0_id, name) VALUES ('u1', 'auth0|m', 'U')`);
    const insert = (id: string, key: string, payload: string) =>
      conn.query(
        `INSERT INTO suggestions (id, user_id, kind, source, dedupe_key, payload)
         VALUES ('${id}', 'u1', 'profile.bio', 'github', '${key}', '${payload}')`,
      );
    await insert('s1', 'k', '{}');
    await expect(insert('s2', 'k', '{}')).rejects.toMatchObject({ errno: 1062 });
    await expect(insert('s3', 'k2', '[]')).rejects.toMatchObject({ errno: 3819 });
  });
});
