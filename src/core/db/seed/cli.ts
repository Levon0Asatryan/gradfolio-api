/**
 * Loads the demo data (seed.ts) into DATABASE_URL's database.
 *
 *   npm run db:seed                       (tsx, reads .env)
 *   node dist/core/db/seed/cli.js         (the image)
 *
 * Refuses in production, and on a database with pending migrations: the seed
 * is written for the latest schema.
 */
import { loadConfig } from '../../config/index.js';
import { describeError } from '../../errors/describe.js';
import { createDatabase } from '../database.js';
import { loadMigrations } from '../migrator/files.js';
import { pending } from '../migrator/runner.js';
import { createPool } from '../pool.js';
import { seed } from './seed.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.NODE_ENV === 'production') {
    throw new Error('refusing to seed with NODE_ENV=production');
  }
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
    await seed(createDatabase(pool));
    process.stdout.write('seed: loaded\n');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(`seed: ${describeError(err)}`);
  process.exit(1);
});
