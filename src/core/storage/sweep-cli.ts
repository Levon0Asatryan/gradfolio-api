/**
 * Deletes uploaded files that no row references.
 *
 *   npm run storage:sweep                      (dry run: lists what would go)
 *   npm run storage:sweep -- --apply           (deletes)
 *   npm run storage:sweep -- --hours 6         (age floor, default 24)
 *
 * Needs STORAGE_BUCKET and credentials that may list and delete in it (on Cloud
 * Run, the service account). Safe to repeat.
 */
import { loadConfig } from '../config/index.js';
import { createDatabase } from '../db/database.js';
import { createPool } from '../db/pool.js';
import { describeError } from '../errors/describe.js';
import { GcsFileStorage } from './gcs-file-storage.js';
import { sweepOrphans } from './sweep.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const hoursArg = process.argv[process.argv.indexOf('--hours') + 1];
  const hours = process.argv.includes('--hours') ? Number(hoursArg) : 24;
  if (!Number.isFinite(hours) || hours < 0) throw new Error('--hours needs a number');

  const cfg = loadConfig();
  if (cfg.STORAGE_BUCKET === undefined) throw new Error('STORAGE_BUCKET is not set');
  const pool = createPool({ ...cfg, DATABASE_POOL_MAX: 2 });
  try {
    const result = await sweepOrphans(
      createDatabase(pool),
      new GcsFileStorage(cfg.STORAGE_BUCKET),
      cfg.STORAGE_BUCKET,
      { apply, minAgeMs: hours * 3_600_000 },
    );
    for (const key of result.orphans)
      process.stdout.write(`${apply ? 'deleted' : 'orphan'} ${key}\n`);
    process.stdout.write(
      `sweep: ${result.scanned} scanned, ${result.orphans.length} orphans, ${result.deleted} deleted${result.kept > 0 ? `, ${result.kept} kept (changed meanwhile)` : ''}${apply ? '' : ' (dry run; pass --apply)'}\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`sweep failed: ${describeError(err)}\n`);
  process.exitCode = 1;
});
