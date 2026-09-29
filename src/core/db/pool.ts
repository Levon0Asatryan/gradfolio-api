import { createPool as createMysqlPool, type Pool, type PoolOptions } from 'mysql2/promise';
import type { AppConfig } from '../config/schema.js';

/** The column mysql2 hands a `typeCast` function. */
type TypeCastField = Parameters<
  Extract<NonNullable<PoolOptions['typeCast']>, (...args: never[]) => unknown>
>[0];

/**
 * Every connection's session time zone.
 *
 * `DATETIME` stores no zone, and `CURRENT_TIMESTAMP` defaults are written in the
 * session zone -- `SYSTEM` unless set. Pinning it to UTC on every connection,
 * together with the driver's own `timezone: 'Z'`, makes what the database writes
 * and what the driver reads agree regardless of where either runs.
 */
export const SESSION_TIME_ZONE = '+00:00';

type DbConfig = Pick<
  AppConfig,
  | 'DATABASE_URL'
  | 'DATABASE_POOL_MAX'
  | 'DATABASE_CONNECT_TIMEOUT_MS'
  | 'DATABASE_SSL'
  | 'DATABASE_SSL_CA'
>;

/**
 * Reads `TINYINT(1)` -- the schema's boolean -- as a JS boolean.
 *
 * mysql2 returns it as the number 0 or 1, and Kysely passes that through, so
 * `isPublic` would be `1` where the types promise `true`. Only display width 1
 * is converted: every boolean column is `TINYINT(1)`, and nothing else is.
 */
export const castTinyIntBoolean = (field: TypeCastField, next: () => unknown): unknown => {
  if (field.type === 'TINY' && field.length === 1) {
    const value = field.string();
    return value === null ? null : value === '1';
  }
  return next();
};

export function poolOptions(cfg: DbConfig): PoolOptions {
  return {
    uri: cfg.DATABASE_URL,
    connectionLimit: cfg.DATABASE_POOL_MAX,
    connectTimeout: cfg.DATABASE_CONNECT_TIMEOUT_MS,
    // The driver converts DATETIME to and from JS Dates as UTC, matching the
    // session zone set below.
    timezone: 'Z',
    charset: 'utf8mb4_unicode_ci',
    typeCast: castTinyIntBoolean,
    // DATE is a calendar day, not an instant: as a JS Date it becomes midnight
    // in some zone, and a reader in another zone sees the day before. Kept as
    // 'YYYY-MM-DD'. DATETIME stays a Date, read as UTC.
    dateStrings: ['DATE'],
    // A dropped idle connection is noticed before a request picks it up.
    enableKeepAlive: true,
    ...(cfg.DATABASE_SSL === 'required'
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(cfg.DATABASE_SSL_CA ? { ca: cfg.DATABASE_SSL_CA } : {}),
          },
        }
      : {}),
  };
}

/**
 * Creates the pool and pins every new connection's session time zone.
 *
 * The `connection` event fires when a connection is created and before it is
 * handed out; a connection runs its commands in order, so the SET is ahead of
 * the first query. If the SET fails the connection is destroyed rather than
 * used with the wrong zone. Both properties are checked against a real MySQL
 * in pool.int.test.ts.
 */
export function createPool(cfg: DbConfig): Pool {
  const pool = createMysqlPool(poolOptions(cfg));

  pool.pool.on('connection', (conn) => {
    conn.query(`SET time_zone = '${SESSION_TIME_ZONE}'`, (err: Error | null) => {
      if (err) conn.destroy();
    });
  });

  return pool;
}
