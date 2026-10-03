/**
 * Migration CLI.
 *
 *   npm run migrate [-- --to <name>]              (tsx, reads .env)
 *   npm run migrate:down [-- --all | --to <name>]
 *   node dist/core/db/migrator/cli.js up|down ... (the image; compose's migrate service)
 *
 * Covered against a real MySQL by runner.int.test.ts and by the CI migrations
 * job (apply, no-op, roll back, re-apply) rather than by unit tests of a mock.
 */
import { loadDatabaseConfig } from '../../config/index.js';
import { describeError } from '../../errors/describe.js';
import { createPool } from '../pool.js';
import { parseCommand } from './args.js';
import { loadMigrations } from './files.js';
import { down, up } from './runner.js';

async function main(): Promise<void> {
  const cmd = parseCommand(process.argv.slice(2));
  const cfg = loadDatabaseConfig();
  // One connection: the migration lock and every step belong to one session.
  const pool = createPool({ ...cfg, DATABASE_POOL_MAX: 1 });
  try {
    const conn = await pool.getConnection();
    try {
      const opts = {
        migrations: await loadMigrations(),
        // stdout, one line per migration: CI and compose read it.
        report: (m: string) => process.stdout.write(`${m}\n`),
        lockTimeoutS: cfg.MIGRATION_LOCK_TIMEOUT_S,
      };
      if (cmd.command === 'up') await up(conn, opts, cmd.to);
      else await down(conn, opts, cmd);
    } finally {
      conn.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(`migrations: ${describeError(err)}`);
  process.exit(1);
});
