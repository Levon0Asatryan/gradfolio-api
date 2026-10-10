/**
 * Loads a measurement-sized dataset (perf-seed.ts) into DATABASE_URL's database.
 *
 *   npm run db:seed:perf            (tsx, reads .env)
 *
 * Refuses in production, on the integration suite's `*_test` database, on one with
 * pending migrations, and on one that already has users: it is for an empty,
 * throwaway database. The load is one transaction, so a failure leaves it empty.
 */
import { loadDatabaseConfig } from '../../config/index.js';
import { describeError } from '../../errors/describe.js';
import { createDatabase } from '../database.js';
import { loadMigrations } from '../migrator/files.js';
import { pending } from '../migrator/runner.js';
import { createPool } from '../pool.js';
import { perfSeed, perfSeedRefusal } from './perf-seed.js';

async function main(): Promise<void> {
  const cfg = loadDatabaseConfig();
  if (cfg.NODE_ENV === 'production') {
    throw new Error('refusing to seed with NODE_ENV=production');
  }
  const refusal = perfSeedRefusal(cfg.DATABASE_URL);
  if (refusal !== undefined) throw new Error(refusal);
  const pool = createPool({ ...cfg, DATABASE_POOL_MAX: 2 });
  try {
    const conn = await pool.getConnection();
    try {
      const todo = await pending(conn, await loadMigrations());
      if (todo.length > 0) {
        throw new Error(`pending migrations (${todo.join(', ')}); run npm run migrate first`);
      }
    } finally {
      conn.release();
    }
    const db = createDatabase(pool);
    const existing = await db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    if (Number(existing.n) > 0) {
      throw new Error('the database already has users; start from an empty one');
    }
    const loaded = await perfSeed(db);
    process.stdout.write(`seed:perf: ${loaded.users} users, ${loaded.projects} projects\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(`seed:perf: ${describeError(err)}`);
  process.exit(1);
});
