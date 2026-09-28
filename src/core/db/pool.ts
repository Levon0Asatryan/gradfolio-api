import { createPool as createMysqlPool, type Pool, type PoolOptions } from 'mysql2/promise';
import type { AppConfig } from '../config/schema.js';

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

export function poolOptions(cfg: DbConfig): PoolOptions {
  return {
    uri: cfg.DATABASE_URL,
    connectionLimit: cfg.DATABASE_POOL_MAX,
    connectTimeout: cfg.DATABASE_CONNECT_TIMEOUT_MS,
    // The driver converts DATETIME to and from JS Dates as UTC, matching the
    // session zone set below.
    timezone: 'Z',
    charset: 'utf8mb4_unicode_ci',
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
