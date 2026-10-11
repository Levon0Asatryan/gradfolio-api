import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchDatabase, type ScratchDatabase, testConfig } from '../../../testing/database.js';
import { createPool } from '../pool.js';
import { loadMigrations } from './files.js';
import { type Connection } from './registry.js';
import { down, up } from './runner.js';
import { dumpSchema } from './schema-dump.js';

/**
 * Migration 0008 (docs/m7-plan.md §9) is additive: applied to a database with
 * data it keeps every row, clears only token columns (which no revision
 * writes), and its down reverses it to the identical schema.
 */
describe('0008_github_connect', () => {
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
  const USER = '11111111-1111-1111-1111-111111111111';

  it('keeps every row and clears a token left by hand, so the CHECK can be added', async () => {
    const o = await opts();
    await up(conn, o, '0007_discovery_indexes');
    await conn.query(
      `INSERT INTO users (id, auth0_id, name) VALUES ('${USER}', 'auth0|m', 'Kept')`,
    );
    await conn.query(
      `INSERT INTO integrations (id, user_id, integration_type, status, access_token, refresh_token, token_expires_at, external_user_id)
       VALUES ('a', '${USER}', 'github', 'connected', 'gho_left', 'ghr_left', UTC_TIMESTAMP(), '42')`,
    );

    expect(await up(conn, o)).toEqual(['0008_github_connect']);

    const [rows] = await conn.query(
      'SELECT status, access_token, refresh_token, token_expires_at, external_user_id, external_login FROM integrations',
    );
    expect(rows).toEqual([
      {
        status: 'connected',
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        external_user_id: '42',
        external_login: null,
      },
    ]);
    const [users] = await conn.query('SELECT name FROM users');
    expect(users).toEqual([{ name: 'Kept' }]);
  });

  it('applies twice with nothing left, and down then up gives the same schema', async () => {
    const o = await opts();
    expect(await up(conn, o)).toContain('0008_github_connect');
    expect(await up(conn, o)).toEqual([]);
    const first = await dumpSchema(conn);
    expect(first).toContain('ck_integrations_no_tokens');
    expect(first).toContain('CREATE TABLE `integration_nonces`');
    expect(first).toContain('CREATE TABLE `project_github_imports`');

    expect(await down(conn, o)).toEqual(['0008_github_connect']);
    const reverted = await dumpSchema(conn);
    expect(reverted).not.toContain('linking');
    expect(reverted).not.toContain('integration_nonces');

    await up(conn, o);
    expect(await dumpSchema(conn)).toBe(first);
  });

  it('down turns a reservation into a plain not-connected row', async () => {
    const o = await opts();
    await up(conn, o);
    await conn.query(
      `INSERT INTO users (id, auth0_id, name) VALUES ('${USER}', 'auth0|m', 'Kept')`,
    );
    await conn.query(
      `INSERT INTO integrations (id, user_id, integration_type, status, external_user_id)
       VALUES ('a', '${USER}', 'github', 'linking', '42')`,
    );
    await down(conn, o);
    const [rows] = await conn.query('SELECT status, external_user_id FROM integrations');
    expect(rows).toEqual([{ status: 'not_connected', external_user_id: null }]);
  });
});
