import { CamelCasePlugin, Kysely, MysqlDialect } from 'kysely';
import type { Pool } from 'mysql2/promise';
import type { DB } from './types.generated.js';

/** The typed query layer: columns are camelCase here, snake_case in MySQL. */
export type Database = Kysely<DB>;

/**
 * Kysely on the app's existing pool, so the pool's per-connection setup (UTC
 * session, TINYINT(1) as boolean, DATE as text) applies to every query.
 *
 * - `pool.pool`, the callback pool underneath the promise one: given the
 *   promise pool itself, Kysely's queries never resolve (kysely#1465; run).
 * - `maintainNestedObjectKeys`: without it the plugin also renames keys
 *   *inside* JSON values -- a stored `{"project_name": …}` would come back as
 *   `{"projectName": …}` (run). JSON is user data; only column names map.
 *
 * Ending the pool is the owner's job (DbService); do not call `destroy()` on
 * this as well, which would end it twice.
 */
export function createDatabase(pool: Pool): Database {
  return new Kysely<DB>({
    dialect: new MysqlDialect({ pool: pool.pool }),
    plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  });
}
