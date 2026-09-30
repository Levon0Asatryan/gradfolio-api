/**
 * Prints the normalized schema of DATABASE_URL's database (see schema-dump.ts).
 *
 *   npm run db:schema > a.sql
 *
 * The CI migrations job diffs two of these to prove up -> down -> up changes
 * nothing.
 */
import { loadDatabaseConfig } from '../../config/index.js';
import { describeError } from '../../errors/describe.js';
import { createPool } from '../pool.js';
import { dumpSchema } from './schema-dump.js';

async function main(): Promise<void> {
  const pool = createPool({ ...loadDatabaseConfig(), DATABASE_POOL_MAX: 1 });
  try {
    process.stdout.write(await dumpSchema(pool));
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(`db:schema: ${describeError(err)}`);
  process.exit(1);
});
