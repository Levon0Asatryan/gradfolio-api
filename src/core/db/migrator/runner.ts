import type { RowDataPacket } from 'mysql2/promise';
import { describeError } from '../../errors/describe.js';
import { type Direction, isDml, type Migration, type Step } from './files.js';
import {
  type Connection,
  ensureRegistry,
  forget,
  readRecords,
  recordStep,
  type StepRecord,
} from './registry.js';

export type Report = (message: string) => void;

export interface RunOptions {
  migrations: Migration[];
  report: Report;
  /** How long to wait for another runner to finish, in seconds. */
  lockTimeoutS: number;
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

interface Progress {
  up: Map<number, string>;
  down: Map<number, string>;
}

/**
 * Applies pending migrations, in name order, up to and including `to`.
 *
 * Each step is recorded the moment it succeeds, so a failure part-way leaves a
 * registry that says exactly which steps are in effect, and the next run
 * resumes at the failed step. A DML step commits in one transaction with its
 * record. A DDL step cannot (MySQL commits DDL implicitly), so it is guarded:
 * after a crash between running it and recording it, the re-run finds it in
 * effect and records it without running it again.
 */
export async function up(conn: Connection, opts: RunOptions, to?: string): Promise<string[]> {
  return withLock(conn, opts.lockTimeoutS, async () => {
    const progress = await loadProgress(conn, opts.migrations);
    const targets = to === undefined ? opts.migrations : upTo(opts.migrations, to);
    const applied: string[] = [];

    for (const m of targets) {
      const done = progress.get(m.name);
      if (done && done.down.size > 0) {
        throw new MigrationError(
          `${m.name} is partially rolled back; finish it with migrate:down before migrating up`,
        );
      }
      const pending = m.up.filter((s) => !done?.up.has(s.index));
      if (pending.length === 0) continue;

      for (const step of pending) await runStep(conn, m.name, 'up', step);
      const first = pending[0]!.index;
      opts.report(
        first === 1
          ? `migrations: applied ${m.name} (${m.up.length} steps)`
          : `migrations: applied ${m.name} (resumed at step ${first} of ${m.up.length})`,
      );
      applied.push(m.name);
    }

    if (applied.length === 0) opts.report('migrations: nothing to apply');
    return applied;
  });
}

export interface DownTarget {
  /** Roll back every applied migration. */
  all?: boolean;
  /** Roll back every applied migration after this one; it stays applied. */
  to?: string;
}

/**
 * Rolls back the latest applied migration (or more, per `target`).
 *
 * Down steps are recorded as they succeed, like up steps; the migration's rows
 * are deleted only once every down step has run. A failure part-way therefore
 * leaves a state the next `down` resumes, and `up` refuses until it has.
 */
export async function down(
  conn: Connection,
  opts: RunOptions,
  target: DownTarget = {},
): Promise<string[]> {
  return withLock(conn, opts.lockTimeoutS, async () => {
    const progress = await loadProgress(conn, opts.migrations);
    const applied = opts.migrations.filter((m) => progress.has(m.name));

    let targets: Migration[];
    if (target.all) targets = [...applied].reverse();
    else if (target.to !== undefined) {
      const keep = new Set(upTo(opts.migrations, target.to).map((m) => m.name));
      targets = applied.filter((m) => !keep.has(m.name)).reverse();
    } else targets = applied.slice(-1);

    const rolledBack: string[] = [];
    for (const m of targets) {
      const done = progress.get(m.name)!;
      for (const step of m.down.filter((s) => !done.down.has(s.index))) {
        await runStep(conn, m.name, 'down', step);
      }
      await forget(conn, m.name);
      opts.report(`migrations: rolled back ${m.name}`);
      rolledBack.push(m.name);
    }

    if (rolledBack.length === 0) opts.report('migrations: nothing to roll back');
    return rolledBack;
  });
}

/**
 * Migrations not fully applied, in order. Reads without the lock; it refuses,
 * like `up`, when the registry contradicts the files.
 */
export async function pending(conn: Connection, migrations: Migration[]): Promise<string[]> {
  const progress = await loadProgress(conn, migrations);
  return migrations
    .filter((m) => {
      const done = progress.get(m.name);
      return !done || done.down.size > 0 || m.up.some((s) => !done.up.has(s.index));
    })
    .map((m) => m.name);
}

function upTo(migrations: Migration[], to: string): Migration[] {
  const i = migrations.findIndex((m) => m.name === to);
  if (i === -1) throw new MigrationError(`no migration named ${to}`);
  return migrations.slice(0, i + 1);
}

/**
 * Reads the registry and refuses to go on when it contradicts the files: a
 * migration the build does not have (the database is ahead of this build), or
 * a recorded step whose SQL has since changed.
 */
async function loadProgress(
  conn: Connection,
  migrations: Migration[],
): Promise<Map<string, Progress>> {
  await ensureRegistry(conn);
  const byName = new Map(migrations.map((m) => [m.name, m]));
  const progress = new Map<string, Progress>();

  for (const r of await readRecords(conn)) {
    const m = byName.get(r.name);
    if (!m) {
      throw new MigrationError(
        `the database records migration ${r.name}, which this build does not have; ` +
          'it is ahead of this build',
      );
    }
    checkUnchanged(m, r);
    const p = progress.get(r.name) ?? { up: new Map(), down: new Map() };
    p[r.direction].set(r.step, r.checksum);
    progress.set(r.name, p);
  }
  return progress;
}

function checkUnchanged(m: Migration, r: StepRecord): void {
  const step = m[r.direction].find((s) => s.index === r.step);
  if (step?.checksum !== r.checksum) {
    throw new MigrationError(
      `${r.name} (${r.direction}) step ${r.step} changed after it was applied; ` +
        'an applied migration is immutable, write a new one instead',
    );
  }
}

async function runStep(
  conn: Connection,
  name: string,
  direction: Direction,
  step: Step,
): Promise<void> {
  const record = { name, direction, step: step.index, checksum: step.checksum };
  try {
    if (isDml(step)) {
      // DML is transactional: the statement and its record commit together,
      // so a failure (or a killed process) in between leaves neither.
      await conn.query('START TRANSACTION');
      try {
        if (!(await alreadyInEffect(conn, step))) await conn.query(step.sql);
        await recordStep(conn, record);
        await conn.query('COMMIT');
      } catch (err) {
        // A failed ROLLBACK means the session is gone, and the server rolls an
        // open transaction back when its session ends; the error that matters
        // is the one being rethrown.
        await conn.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    } else {
      // DDL commits implicitly, so no transaction can hold it and its record
      // together; the step's guard closes that window instead.
      if (!(await alreadyInEffect(conn, step))) await conn.query(step.sql);
      await recordStep(conn, record);
    }
  } catch (err) {
    throw new MigrationError(
      `${name} (${direction}) step ${step.index} failed: ${describeError(err)}`,
      {
        cause: err,
      },
    );
  }
}

async function alreadyInEffect(conn: Connection, step: Step): Promise<boolean> {
  if (step.guard === undefined) return false;
  const [rows] = await conn.query<RowDataPacket[]>(step.guard);
  if (!Array.isArray(rows)) throw new Error('a skip-if guard must be a SELECT');
  return rows.length > 0;
}

/**
 * Holds a named lock for the duration of `work`, so two runners (the compose
 * `migrate` service and a developer, say) cannot interleave steps. The lock
 * belongs to the session: a runner that dies releases it. It is named after the
 * database, so runners on different databases of one server do not wait for
 * each other.
 */
async function withLock<T>(conn: Connection, timeoutS: number, work: () => Promise<T>): Promise<T> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT GET_LOCK(CONCAT('gradfolio_migrate:', DATABASE()), ?) AS got",
    [timeoutS],
  );
  if (rows[0]?.got !== 1) {
    throw new MigrationError(
      `another migration is running on this database (waited ${timeoutS}s for its lock)`,
    );
  }
  try {
    return await work();
  } finally {
    // A release that fails means the session is gone, and a session's locks
    // go with it. Letting that error out would replace the one that matters.
    await conn
      .query("SELECT RELEASE_LOCK(CONCAT('gradfolio_migrate:', DATABASE()))")
      .catch(() => undefined);
  }
}
