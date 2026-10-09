import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isDml, isRerunnable, loadMigrations, MigrationFileError, parseSteps } from './files.js';

describe('parseSteps', () => {
  it('splits on a semicolon at the end of a line, one statement per step', () => {
    const steps = parseSteps('CREATE TABLE IF NOT EXISTS a (id INT);\nDROP TABLE IF EXISTS b;\n');
    expect(steps.map((s) => [s.index, s.sql])).toEqual([
      [1, 'CREATE TABLE IF NOT EXISTS a (id INT)'],
      [2, 'DROP TABLE IF EXISTS b'],
    ]);
  });

  it('keeps a multi-line statement together and does not split inside a line', () => {
    const [step, ...rest] = parseSteps("UPDATE t\n  SET note = 'a; b'\n  WHERE id = 1;\n");
    expect(rest).toEqual([]);
    expect(step?.sql).toBe("UPDATE t\n  SET note = 'a; b'\n  WHERE id = 1");
  });

  it('drops whole-line comments, even ones ending in a semicolon', () => {
    const steps = parseSteps(
      '-- header;\nCREATE TABLE IF NOT EXISTS a (\n  -- a note;\n  id INT\n);\n',
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]?.sql).toBe('CREATE TABLE IF NOT EXISTS a (\n  id INT\n)');
  });

  it('attaches a skip-if guard to the statement after it', () => {
    const [plain, guarded] = parseSteps(
      'DROP TABLE IF EXISTS a;\n-- skip-if: SELECT 1 FROM information_schema.columns WHERE x\nALTER TABLE b ADD COLUMN c INT;\n',
    );
    expect(plain?.guard).toBeUndefined();
    expect(guarded?.guard).toBe('SELECT 1 FROM information_schema.columns WHERE x');
    expect(guarded?.sql).toBe('ALTER TABLE b ADD COLUMN c INT');
  });

  it('checksums the SQL only, so editing comments does not change it', () => {
    const a = parseSteps('-- one\nDROP TABLE IF EXISTS a;\n')[0]!;
    const b = parseSteps('-- two, reworded\nDROP TABLE IF EXISTS a;\n')[0]!;
    const c = parseSteps('DROP TABLE IF EXISTS b;\n')[0]!;
    expect(a.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).not.toBe(c.checksum);
  });

  it.each([
    ['a statement without its semicolon', 'DROP TABLE IF EXISTS a', /no terminating/],
    [
      'a guard inside a statement',
      'ALTER TABLE a\n-- skip-if: SELECT 1\nADD c INT;',
      /before its statement/,
    ],
    [
      'two guards for one statement',
      '-- skip-if: SELECT 1\n-- skip-if: SELECT 2\nALTER TABLE a ADD c INT;',
      /two skip-if/,
    ],
    [
      'a guard with nothing after it',
      'DROP TABLE IF EXISTS a;\n-- skip-if: SELECT 1\n',
      /no statement after/,
    ],
  ])('rejects %s', (_label, text, error) => {
    expect(() => parseSteps(text, 'x.up.sql')).toThrow(error);
    expect(() => parseSteps(text, 'x.up.sql')).toThrow(MigrationFileError);
  });
});

describe('isRerunnable', () => {
  const step = (text: string) => parseSteps(text)[0]!;

  it.each([
    'CREATE TABLE IF NOT EXISTS a (id INT);',
    'DROP TABLE IF EXISTS a;',
    'INSERT INTO t (a) SELECT a FROM s ON DUPLICATE KEY UPDATE t.a = t.a;',
    'UPDATE t SET a = TRIM(a) WHERE a <> TRIM(a);',
    "DELETE FROM t WHERE a = '';",
    "-- skip-if: SELECT 1 FROM information_schema.columns WHERE column_name = 'c'\nALTER TABLE a ADD COLUMN c INT;",
  ])('accepts %j', (text) => {
    expect(isRerunnable(step(text))).toBe(true);
  });

  it.each([
    'CREATE TABLE a (id INT);',
    'ALTER TABLE a ADD COLUMN c INT;',
    'CREATE INDEX ix ON a (c);',
    'INSERT INTO t (a) VALUES (1);',
    'RENAME TABLE a TO b;',
  ])('rejects %j without a guard', (text) => {
    expect(isRerunnable(step(text))).toBe(false);
  });
});

describe('isDml', () => {
  const step = (text: string) => parseSteps(text)[0]!;

  it.each([
    'INSERT INTO t (a) SELECT a FROM s ON DUPLICATE KEY UPDATE t.a = t.a;',
    'insert into t values (1);',
    'UPDATE t SET a = 1;',
    'UPDATE /*+ SET_VAR(group_concat_max_len = 1048576) */ t SET a = 1;',
    'DELETE s1 FROM t s1 JOIN t s2 ON s1.a = s2.a;',
    'REPLACE INTO t VALUES (1);',
  ])('runs %j in a transaction', (text) => {
    expect(isDml(step(text))).toBe(true);
  });

  // Anything not provably DML keeps the guarded DDL scheme. TRUNCATE and
  // CREATE … SELECT commit implicitly, so a transaction would be a lie.
  it.each([
    'CREATE TABLE IF NOT EXISTS a (id INT);',
    'CREATE TABLE a2 AS SELECT * FROM a;',
    'ALTER TABLE a ADD COLUMN c INT;',
    'DROP TABLE IF EXISTS a;',
    'TRUNCATE TABLE a;',
    'RENAME TABLE a TO b;',
    'SET @x = 1;',
    'CALL do_something();',
    'WITH x AS (SELECT 1) DELETE FROM a;',
    '/* note */ DELETE FROM a;',
  ])('treats %j as DDL', (text) => {
    expect(isDml(step(text))).toBe(false);
  });
});

describe('the migrations in this repository', () => {
  it('are named in order, with both halves, and every step can be re-run', async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((m) => m.name)).toEqual(migrations.map((m) => m.name).sort());

    // A step that cannot be re-run turns a partial failure into a migration
    // stuck until someone repairs the database by hand.
    const unguarded = migrations.flatMap((m) =>
      (['up', 'down'] as const).flatMap((d) =>
        m[d].filter((s) => !isRerunnable(s)).map((s) => `${m.name}.${d} step ${s.index}`),
      ),
    );
    expect(unguarded).toEqual([]);
  });

  it('run exactly 0003’s backfills and 0006’s down clean-up as DML; every other step is DDL', async () => {
    const dml = (await loadMigrations()).flatMap((m) =>
      (['up', 'down'] as const).flatMap((d) =>
        m[d].filter(isDml).map((s) => `${m.name}.${d}.${s.index}`),
      ),
    );
    expect(dml).toEqual([
      ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((i) => `0003_project_terms.up.${i}`),
      '0003_project_terms.down.2',
      '0003_project_terms.down.3',
      '0006_team_notifications.down.3',
    ]);
  });

  it('the baseline creates the 11 tables of gradfolio-sql, and its down drops them', async () => {
    const [baseline] = await loadMigrations();
    expect(baseline?.name).toBe('0001_baseline');
    const created = baseline!.up.map((s) => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(s.sql)?.[1]);
    const dropped = baseline!.down.map((s) => /^DROP TABLE IF EXISTS (\w+)/.exec(s.sql)?.[1]);
    expect(created).toHaveLength(11);
    expect(dropped).toEqual([...created].reverse());
  });
});

describe('loadMigrations', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function withFiles(files: Record<string, string>): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'gradfolio-migrations-'));
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
    return dir;
  }

  it('orders by name and pairs the halves', async () => {
    const d = await withFiles({
      '0002_b.up.sql': 'DROP TABLE IF EXISTS b;\n',
      '0002_b.down.sql': 'DROP TABLE IF EXISTS b;\n',
      '0001_a.down.sql': 'DROP TABLE IF EXISTS a;\n',
      '0001_a.up.sql': 'CREATE TABLE IF NOT EXISTS a (id INT);\n',
    });
    const migrations = await loadMigrations(d);
    expect(migrations.map((m) => [m.name, m.up.length, m.down.length])).toEqual([
      ['0001_a', 1, 1],
      ['0002_b', 1, 1],
    ]);
  });

  it.each([
    [{ '0001_a.up.sql': 'DROP TABLE IF EXISTS a;\n' }, /needs both/],
    [{ '1_a.up.sql': 'x;\n', '1_a.down.sql': 'x;\n' }, /not named/],
    [
      { '0001_a.up.sql': '-- nothing\n', '0001_a.down.sql': 'DROP TABLE IF EXISTS a;\n' },
      /no statements/,
    ],
    [{ '0001_a.up.sql': 'DROP TABLE IF EXISTS a;\n', '0001_a.down.sql': '\n' }, /no statements/],
  ])('refuses a malformed directory (%#)', async (files, error) => {
    await expect(loadMigrations(await withFiles(files))).rejects.toThrow(error);
  });
});
