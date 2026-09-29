import { createPool } from '../core/db/pool.js';
import { loadMigrations } from '../core/db/migrator/files.js';
import { up } from '../core/db/migrator/runner.js';
import { testConfig } from './database.js';

/**
 * Brings the integration database to the latest migration once per run, the
 * way `npm run migrate` does, so every file tests against the real schema.
 */
export default async function setup(): Promise<void> {
  const cfg = testConfig();
  const pool = createPool({ ...cfg, DATABASE_POOL_MAX: 1 });
  const conn = await pool.getConnection();
  try {
    await up(conn, {
      migrations: await loadMigrations(),
      report: () => undefined,
      lockTimeoutS: cfg.MIGRATION_LOCK_TIMEOUT_S,
    });
  } finally {
    conn.release();
    await pool.end();
  }
}
