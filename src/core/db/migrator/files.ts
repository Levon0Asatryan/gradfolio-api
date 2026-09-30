import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Direction = 'up' | 'down';

/** Migrations live beside this module; the Nest build copies them into dist. */
export const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

/** `0001_baseline.up.sql` -> `0001_baseline`. */
const FILE = /^(\d{4}_[a-z0-9_]+)\.(up|down)\.sql$/;

/** A line that introduces a step's guard: `-- skip-if: SELECT ...`. */
const GUARD = /^\s*--\s*skip-if:\s*(.+?)\s*$/;
const COMMENT = /^\s*--/;
/** A statement ends with `;` at the end of a line. */
const END = /;\s*$/;

/**
 * One statement of a migration.
 *
 * MySQL commits every DDL statement implicitly, so a migration cannot be one
 * transaction. The runner records each step as soon as it succeeds instead,
 * and a step must be safe to run again: its `guard` (a SELECT that returns a
 * row when the step is already in effect), or a statement that is idempotent
 * by itself (see `isRerunnable`).
 */
export interface Step {
  /** 1-based position in its file. */
  index: number;
  sql: string;
  guard?: string;
  /** sha256 of `sql`. Comments are not part of it, so editing them is safe. */
  checksum: string;
}

export interface Migration {
  name: string;
  up: Step[];
  down: Step[];
}

export class MigrationFileError extends Error {
  override name = 'MigrationFileError';
}

/**
 * Splits a migration file into steps.
 *
 * A step is one statement, ending with `;` at the end of a line. Whole-line
 * `--` comments are dropped; a `-- skip-if:` line guards the statement that
 * follows it. Semicolons inside a line (string literals) do not split.
 */
export function parseSteps(text: string, source = 'migration'): Step[] {
  const steps: Step[] = [];
  let lines: string[] = [];
  let guard: string | undefined;

  const fail = (lineNo: number, why: string): never => {
    throw new MigrationFileError(`${source}:${lineNo}: ${why}`);
  };

  text.split('\n').forEach((line, i) => {
    const lineNo = i + 1;
    const guardMatch = GUARD.exec(line);
    if (guardMatch) {
      if (lines.length > 0) fail(lineNo, 'a skip-if guard must come before its statement');
      if (guard !== undefined) fail(lineNo, 'two skip-if guards for one statement');
      guard = guardMatch[1];
      return;
    }
    if (COMMENT.test(line)) return;
    if (lines.length === 0 && line.trim() === '') return;

    lines.push(line);
    if (END.test(line)) {
      const sql = lines.join('\n').trim().replace(END, '').trim();
      steps.push({
        index: steps.length + 1,
        sql,
        ...(guard === undefined ? {} : { guard }),
        checksum: createHash('sha256').update(sql).digest('hex'),
      });
      lines = [];
      guard = undefined;
    }
  });

  if (lines.some((l) => l.trim() !== '')) {
    throw new MigrationFileError(`${source}: the last statement has no terminating ';'`);
  }
  if (guard !== undefined) {
    throw new MigrationFileError(`${source}: a skip-if guard with no statement after it`);
  }
  return steps;
}

const RERUNNABLE = [
  /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i,
  /^DROP\s+TABLE\s+IF\s+EXISTS\b/i,
  /^INSERT\b[\s\S]*\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i,
  /^UPDATE\b/i,
  /^DELETE\b/i,
];

/**
 * Whether running the step a second time is safe.
 *
 * MySQL 8.4 has native guards only for tables: `ADD COLUMN IF NOT EXISTS`,
 * `CREATE INDEX IF NOT EXISTS`, `DROP INDEX IF EXISTS` and the CHECK variants
 * are syntax errors (1064). Anything else needs a `skip-if` guard. UPDATE and
 * DELETE are accepted as written: a backfill must be deterministic.
 */
export function isRerunnable(step: Step): boolean {
  return step.guard !== undefined || RERUNNABLE.some((re) => re.test(step.sql));
}

/**
 * A step MySQL runs inside a transaction: plain INSERT, UPDATE, DELETE or
 * REPLACE. The runner then commits the statement together with its record, so
 * a failure between the two leaves neither.
 *
 * Deliberately narrow: anything else -- DDL, TRUNCATE, `CREATE TABLE … SELECT`,
 * CALL, SET, a statement starting with a comment or a CTE -- counts as DDL and
 * keeps the guarded scheme. Treating a DDL statement as DML would be the unsafe
 * mistake (its implicit commit would split the transaction); the reverse only
 * loses the atomicity this adds. A step is one statement, so it cannot mix the
 * two: with multipleStatements off, a second statement is a syntax error.
 */
const DML = /^(INSERT|UPDATE|DELETE|REPLACE)\b/i;

export function isDml(step: Step): boolean {
  return DML.test(step.sql);
}

/** Every migration in the directory, in name order, with both directions parsed. */
export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const byName = new Map<string, Partial<Record<Direction, string>>>();

  for (const file of entries) {
    const match = FILE.exec(file);
    if (!match) throw new MigrationFileError(`${file}: not named NNNN_name.(up|down).sql`);
    const [, name, direction] = match as unknown as [string, string, Direction];
    byName.set(name, { ...byName.get(name), [direction]: file });
  }

  const migrations: Migration[] = [];
  for (const [name, files] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    if (!files.up || !files.down) {
      throw new MigrationFileError(`${name}: needs both an .up.sql and a .down.sql file`);
    }
    const up = parseSteps(await readFile(join(dir, files.up), 'utf8'), files.up);
    const down = parseSteps(await readFile(join(dir, files.down), 'utf8'), files.down);
    if (up.length === 0) throw new MigrationFileError(`${files.up}: has no statements`);
    if (down.length === 0) throw new MigrationFileError(`${files.down}: has no statements`);
    migrations.push({ name, up, down });
  }
  return migrations;
}
