import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Direction } from './files.js';

/** What the runner needs from a connection: one session, statements in order. */
export type Connection = Pick<PoolConnection, 'query'>;

/**
 * One row per step that has run, recorded right after the step succeeded.
 *
 * Per step rather than per migration because MySQL commits DDL implicitly: a
 * migration that fails at step 3 has already committed steps 1 and 2, and the
 * record has to say so.
 */
export const REGISTRY_TABLE = 'schema_migrations';

export interface StepRecord {
  name: string;
  direction: Direction;
  step: number;
  checksum: string;
}

export async function ensureRegistry(conn: Connection): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ${REGISTRY_TABLE} (
      name       VARCHAR(255)      NOT NULL,
      direction  ENUM('up','down') NOT NULL,
      step       INT               NOT NULL,
      checksum   CHAR(64)          NOT NULL,
      applied_at DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (name, direction, step)
    )
  `);
}

export async function readRecords(conn: Connection): Promise<StepRecord[]> {
  const [rows] = await conn.query<(RowDataPacket & StepRecord)[]>(
    `SELECT name, direction, step, checksum FROM ${REGISTRY_TABLE} ORDER BY name, direction, step`,
  );
  return rows.map(({ name, direction, step, checksum }) => ({ name, direction, step, checksum }));
}

export async function recordStep(conn: Connection, record: StepRecord): Promise<void> {
  await conn.query(
    `INSERT INTO ${REGISTRY_TABLE} (name, direction, step, checksum) VALUES (?, ?, ?, ?)`,
    [record.name, record.direction, record.step, record.checksum],
  );
}

/** Forgets a migration entirely: the last act of rolling it back. */
export async function forget(conn: Connection, name: string): Promise<void> {
  await conn.query(`DELETE FROM ${REGISTRY_TABLE} WHERE name = ?`, [name]);
}
