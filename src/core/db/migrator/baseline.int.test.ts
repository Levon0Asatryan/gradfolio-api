import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scratchDatabase, type ScratchDatabase, testConfig } from '../../../testing/database.js';
import { createPool } from '../pool.js';
import { loadMigrations, parseSteps } from './files.js';
import { up } from './runner.js';
import { dumpSchema } from './schema-dump.js';

/**
 * gradfolio-sql's sql/schema.sql at commit 187ff66, byte for byte. The CI
 * migrations job checks this copy against that commit on GitHub.
 */
const REFERENCE = join(import.meta.dirname, '../../../testing/fixtures/gradfolio-sql-schema.sql');

/**
 * 1.2: the baseline migration produces exactly the schema gradfolio-sql
 * shipped. Database A gets schema.sql, database B only 0001_baseline through
 * the runner; the normalized SHOW CREATE TABLE of both must be identical.
 */
describe('0001_baseline', () => {
  let a: ScratchDatabase;
  let b: ScratchDatabase;
  const pools: ReturnType<typeof createPool>[] = [];
  const poolFor = (d: ScratchDatabase) => {
    const pool = createPool({ ...testConfig(), DATABASE_URL: d.url, DATABASE_POOL_MAX: 1 });
    pools.push(pool);
    return pool;
  };

  beforeAll(async () => {
    [a, b] = await Promise.all([scratchDatabase(), scratchDatabase()]);
  });

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
    await Promise.all([a?.drop(), b?.drop()]);
  });

  it('is identical to gradfolio-sql schema.sql, table for table', async () => {
    const reference = await readFile(REFERENCE, 'utf8');
    const poolA = poolFor(a);
    // schema.sql targets a database called gradfolio; this one has its own name.
    for (const step of parseSteps(reference, 'schema.sql')) {
      if (/^(CREATE DATABASE|USE)\b/i.test(step.sql)) continue;
      await poolA.query(step.sql);
    }

    const poolB = poolFor(b);
    const conn = await poolB.getConnection();
    try {
      await up(
        conn,
        { migrations: await loadMigrations(), report: () => undefined, lockTimeoutS: 5 },
        '0001_baseline',
      );
    } finally {
      conn.release();
    }

    const [schemaA, schemaB] = await Promise.all([dumpSchema(poolA), dumpSchema(poolB)]);
    expect(schemaA.match(/^CREATE TABLE/gm)).toHaveLength(11);
    expect(schemaB).toBe(schemaA);
  });
});
