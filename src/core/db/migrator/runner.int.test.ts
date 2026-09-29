import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchDatabase, type ScratchDatabase, testConfig } from '../../../testing/database.js';
import { createPool } from '../pool.js';
import { loadMigrations, type Migration, parseSteps } from './files.js';
import { type Connection, REGISTRY_TABLE } from './registry.js';
import { down, MigrationError, type RunOptions, up } from './runner.js';
import { dumpSchema } from './schema-dump.js';

/** Polls a condition on the server; fails the test if it never holds. */
async function until(condition: () => Promise<boolean>, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition never held');
}

/** A migration built in memory, parsed exactly as a file would be. */
function migration(name: string, upSql: string, downSql: string): Migration {
  return {
    name,
    up: parseSteps(upSql, `${name}.up.sql`),
    down: parseSteps(downSql, `${name}.down.sql`),
  };
}

const COLUMN_X_EXISTS =
  "-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'step_one' AND column_name = 'x'";
const COLUMN_X_ABSENT =
  "-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'step_one' AND column_name = 'x')";

const twoSteps = (step2: string) =>
  migration(
    '0001_two_steps',
    `CREATE TABLE IF NOT EXISTS step_one (id INT PRIMARY KEY);\n${COLUMN_X_EXISTS}\n${step2};\n`,
    `${COLUMN_X_ABSENT}\nALTER TABLE step_one DROP COLUMN x;\nDROP TABLE IF EXISTS step_one;\n`,
  );
const broken = twoSteps('ALTER TABLE does_not_exist ADD COLUMN x INT');
const fixed = twoSteps('ALTER TABLE step_one ADD COLUMN x INT');

describe('migration runner against MySQL 8.4', () => {
  let db: ScratchDatabase;
  let pool: ReturnType<typeof createPool>;
  let conn: Connection & { release: () => void };
  let reported: string[];

  const opts = (migrations: Migration[], lockTimeoutS = 5): RunOptions => ({
    migrations,
    report: (m) => reported.push(m),
    lockTimeoutS,
  });
  const rows = async (sql: string, params: unknown[] = []) =>
    (await conn.query<RowDataPacket[]>(sql, params))[0];
  const recorded = async () =>
    (
      await rows(
        `SELECT name, direction, step FROM ${REGISTRY_TABLE} ORDER BY name, direction, step`,
      )
    ).map((r) => `${r.name}.${r.direction}.${r.step}`);
  const columns = async (table: string) =>
    (
      await rows(
        'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position',
        [table],
      )
    ).map((r) => r.c as string);

  beforeEach(async () => {
    db = await scratchDatabase();
    pool = createPool({ ...testConfig(), DATABASE_URL: db.url, DATABASE_POOL_MAX: 2 });
    conn = await pool.getConnection();
    reported = [];
  });

  afterEach(async () => {
    conn.release();
    await pool.end();
    await db.drop();
  });

  it('applies each step, records it, and a second run has nothing to do', async () => {
    expect(await up(conn, opts([fixed]))).toEqual(['0001_two_steps']);
    expect(await recorded()).toEqual(['0001_two_steps.up.1', '0001_two_steps.up.2']);
    expect(await columns('step_one')).toEqual(['id', 'x']);

    expect(await up(conn, opts([fixed]))).toEqual([]);
    expect(reported).toEqual([
      'migrations: applied 0001_two_steps (2 steps)',
      'migrations: nothing to apply',
    ]);
  });

  it('records a step the moment it succeeds, so a failed migration resumes where it stopped', async () => {
    const error = await up(conn, opts([broken])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationError);
    expect(String((error as Error).message)).toMatch(
      /0001_two_steps \(up\) step 2 failed: .*does_not_exist/,
    );
    // DDL committed implicitly: step 1 is in effect, and the registry says so.
    expect(await columns('step_one')).toEqual(['id']);
    expect(await recorded()).toEqual(['0001_two_steps.up.1']);

    // The author fixes step 2; the next run completes it without redoing step 1.
    expect(await up(conn, opts([fixed]))).toEqual(['0001_two_steps']);
    expect(reported.at(-1)).toBe('migrations: applied 0001_two_steps (resumed at step 2 of 2)');
    expect(await columns('step_one')).toEqual(['id', 'x']);
    expect(await recorded()).toEqual(['0001_two_steps.up.1', '0001_two_steps.up.2']);
  });

  it('closes the crash window: a step in effect but unrecorded is recorded, not re-run', async () => {
    await up(conn, opts([fixed]));
    // What a process killed between running step 2 and recording it leaves behind.
    await conn.query(`DELETE FROM ${REGISTRY_TABLE} WHERE step = 2`);

    // Without the guard this would be ADD COLUMN x again: 1060 duplicate column.
    expect(await up(conn, opts([fixed]))).toEqual(['0001_two_steps']);
    expect(await recorded()).toEqual(['0001_two_steps.up.1', '0001_two_steps.up.2']);
  });

  it('refuses when an applied step has been edited', async () => {
    await up(conn, opts([fixed]));
    const edited = twoSteps('ALTER TABLE step_one ADD COLUMN x BIGINT');
    await expect(up(conn, opts([edited]))).rejects.toThrow(
      /0001_two_steps \(up\) step 2 changed after it was applied/,
    );
  });

  it('refuses a database that records a migration this build does not have', async () => {
    const later = migration(
      '0002_later',
      'DROP TABLE IF EXISTS nothing_1;\n',
      'DROP TABLE IF EXISTS nothing_2;\n',
    );
    await up(conn, opts([fixed, later]));
    await expect(up(conn, opts([fixed]))).rejects.toThrow(/0002_later.*ahead of this build/);
    await expect(down(conn, opts([fixed]))).rejects.toThrow(/ahead of this build/);
  });

  it('refuses to run while another runner holds the lock on this database', async () => {
    const other = await createConnection({ uri: db.url });
    try {
      const [got] = await other.query<RowDataPacket[]>(
        "SELECT GET_LOCK(CONCAT('gradfolio_migrate:', DATABASE()), 0) AS got",
      );
      expect(got[0]?.got).toBe(1);

      await expect(up(conn, opts([fixed], 0))).rejects.toThrow(/another migration is running/);
      // It stopped before touching anything, the registry included.
      const tables = await rows(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()',
      );
      expect(tables).toEqual([]);
    } finally {
      await other.end();
    }
    // The holder's session ended, so its lock goes with it. end() resolves
    // once the quit is sent, before the server has closed the session, so wait
    // for the server to report the lock free rather than for a fixed time.
    await until(async () => {
      const [free] = await conn.query<RowDataPacket[]>(
        "SELECT IS_FREE_LOCK(CONCAT('gradfolio_migrate:', DATABASE())) AS free",
      );
      return free[0]?.free === 1;
    });
    expect(await up(conn, opts([fixed], 0))).toEqual(['0001_two_steps']);
  });

  it('releases the lock after a failed run', async () => {
    await up(conn, opts([broken])).catch(() => undefined);
    const other = await createConnection({ uri: db.url });
    try {
      const [got] = await other.query<RowDataPacket[]>(
        "SELECT GET_LOCK(CONCAT('gradfolio_migrate:', DATABASE()), 0) AS got",
      );
      expect(got[0]?.got).toBe(1);
    } finally {
      await other.end();
    }
  });

  it('resumes a rollback that failed part-way, and refuses to migrate up meanwhile', async () => {
    const before = await dumpSchema(conn);
    await up(conn, opts([fixed]));

    // A down whose second step fails: step 1 (drop x) has committed.
    const brokenDown = migration(
      '0001_two_steps',
      fixed.up.map((s) => `${s.guard ? `-- skip-if: ${s.guard}\n` : ''}${s.sql};`).join('\n'),
      `${COLUMN_X_ABSENT}\nALTER TABLE step_one DROP COLUMN x;\nDROP TABLE does_not_exist;\n`,
    );
    await expect(down(conn, opts([brokenDown]))).rejects.toThrow(/\(down\) step 2 failed/);
    expect(await columns('step_one')).toEqual(['id']);
    expect(await recorded()).toEqual([
      '0001_two_steps.up.1',
      '0001_two_steps.up.2',
      '0001_two_steps.down.1',
    ]);

    await expect(up(conn, opts([fixed]))).rejects.toThrow(/partially rolled back/);

    expect(await down(conn, opts([fixed]))).toEqual(['0001_two_steps']);
    expect(await recorded()).toEqual([]);
    expect(await dumpSchema(conn)).toBe(before);
  });

  it('rolls back a migration that failed part-way up, leaving nothing behind', async () => {
    const before = await dumpSchema(conn);
    await up(conn, opts([broken])).catch(() => undefined);
    expect(await recorded()).toEqual(['0001_two_steps.up.1']);

    // Its down steps are guarded, so undoing the step that never ran is a no-op.
    expect(await down(conn, opts([broken]))).toEqual(['0001_two_steps']);
    expect(await recorded()).toEqual([]);
    expect(await dumpSchema(conn)).toBe(before);
  });

  it('rolls back the latest by default, everything after --to, or everything with --all', async () => {
    const m = (n: string) =>
      migration(
        n,
        `CREATE TABLE IF NOT EXISTS t_${n} (id INT);\n`,
        `DROP TABLE IF EXISTS t_${n};\n`,
      );
    const all = [m('0001_a'), m('0002_b'), m('0003_c')];

    await up(conn, opts(all), '0002_b');
    expect(await recorded()).toEqual(['0001_a.up.1', '0002_b.up.1']);
    await up(conn, opts(all));

    expect(await down(conn, opts(all))).toEqual(['0003_c']);
    await up(conn, opts(all));
    expect(await down(conn, opts(all), { to: '0001_a' })).toEqual(['0003_c', '0002_b']);
    expect(await down(conn, opts(all), { all: true })).toEqual(['0001_a']);
    expect(await down(conn, opts(all), { all: true })).toEqual([]);
    expect(reported.at(-1)).toBe('migrations: nothing to roll back');

    await expect(up(conn, opts(all), 'nope')).rejects.toThrow(/no migration named nope/);
  });

  it("the repository's migrations: up, down --all, up again gives an identical schema", async () => {
    const migrations = await loadMigrations();
    await up(conn, opts(migrations));
    const first = await dumpSchema(conn);
    expect(first).toContain('CREATE TABLE `users`');

    await down(conn, opts(migrations), { all: true });
    const left = await rows(
      'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    expect(left.map((r) => r.t as string)).toEqual([REGISTRY_TABLE]);
    expect(await recorded()).toEqual([]);

    await up(conn, opts(migrations));
    expect(await dumpSchema(conn)).toBe(first);
  });
});
