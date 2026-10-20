import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchDatabase, type ScratchDatabase, testConfig } from '../../../testing/database.js';
import { createPool } from '../pool.js';
import { loadMigrations } from './files.js';
import { type Connection } from './registry.js';
import { down, up } from './runner.js';
import { dumpSchema } from './schema-dump.js';

describe('0012_email', () => {
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
    migrations: (await loadMigrations()).filter((m) => m.name <= '0012_email'),
    report: () => undefined,
    lockTimeoutS: 5,
  });

  it('preserves old accounts and does not treat the profile badge as email verification', async () => {
    const o = await opts();
    await up(conn, o, '0011_suggestions_notification');
    await conn.query(
      "INSERT INTO users (id, auth0_id, name, email, verified) VALUES ('u1', 'auth0|email', 'Kept', 'kept@example.com', 1)",
    );
    expect(await up(conn, o)).toEqual(['0012_email']);
    const [rows] = await conn.query(
      'SELECT name, email, verified, email_verified, preferred_language, team_invite_email_enabled, email_suppressed FROM users',
    );
    expect(rows).toEqual([
      {
        name: 'Kept',
        email: 'kept@example.com',
        verified: true,
        email_verified: false,
        preferred_language: 'en',
        team_invite_email_enabled: true,
        email_suppressed: false,
      },
    ]);
  });
  it('applies idempotently and reverses only the email schema', async () => {
    const o = await opts();
    await up(conn, o, '0011_suggestions_notification');
    const previous = await dumpSchema(conn);
    await up(conn, o);
    const next = await dumpSchema(conn);
    expect(next).toContain('CREATE TABLE `email_outbox`');
    expect(await up(conn, o)).toEqual([]);
    expect(await down(conn, o)).toEqual(['0012_email']);
    expect(await dumpSchema(conn)).toBe(previous);
    await up(conn, o);
    expect(await dumpSchema(conn)).toBe(next);
  });
});
