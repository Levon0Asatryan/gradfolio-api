/**
 * Re-sanitizes stored project descriptions with the current allow-list.
 *
 *   npm run projects:resanitize              (dry run: counts what would change)
 *   npm run projects:resanitize -- --apply   (writes)
 *
 * Run it after changing the allow-list in core/validation/html.ts. Idempotent.
 */
import { loadDatabaseConfig } from '../config/index.js';
import { describeError } from '../errors/describe.js';
import { createDatabase } from './database.js';
import { createPool } from './pool.js';
import { resanitizeDescriptions } from './resanitize.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const cfg = loadDatabaseConfig();
  const pool = createPool({ ...cfg, DATABASE_POOL_MAX: 2 });
  try {
    const { scanned, changed } = await resanitizeDescriptions(createDatabase(pool), { apply });
    process.stdout.write(
      `resanitize: ${scanned} scanned, ${changed} ${apply ? 'rewritten' : 'would change (dry run; pass --apply)'}\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`resanitize failed: ${describeError(err)}\n`);
  process.exitCode = 1;
});
