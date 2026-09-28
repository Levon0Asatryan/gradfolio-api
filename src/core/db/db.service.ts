import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/schema.js';
import { createPool } from './pool.js';

/**
 * Owns the MySQL pool for the process lifetime.
 *
 * The query layer on top of it (query builder or ORM) is an M0 decision; until
 * then this exposes the pool and a bounded liveness query.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    // Lazy: mysql2 opens connections on first use, so constructing the app
    // does not need a reachable database -- readiness reports that instead.
    this.pool = createPool(cfg);
  }

  /** `SELECT 1`, bounded by `timeoutMs` in time and in resources. */
  async ping(timeoutMs: number): Promise<void> {
    await this.queryWithin('SELECT 1', timeoutMs);
  }

  /**
   * Runs `sql` on its own connection and gives up after `timeoutMs` --
   * **destroying the connection** rather than leaving the query running.
   *
   * mysql2's own `timeout` option is not enough: it rejects the caller on time
   * but keeps the connection busy until the server finishes (measured: a timed-
   * out `SELECT SLEEP(3)` at 300 ms still held a one-connection pool for 2.7 s).
   * A caller repeating every few seconds against a stalled server would then
   * drain the pool. Destroying the connection frees its slot at once.
   *
   * A connection acquired only after the deadline is released unused.
   */
  async queryWithin(sql: string, timeoutMs: number): Promise<void> {
    let conn: PoolConnection | undefined;
    let expired = false;
    let timer: NodeJS.Timeout | undefined;

    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        conn?.destroy();
        reject(new Error(`database query exceeded ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const work = (async () => {
      const acquired = await this.pool.getConnection();
      if (expired) {
        acquired.release();
        return;
      }
      conn = acquired;
      try {
        await acquired.query(sql);
      } finally {
        if (!expired) acquired.release();
      }
    })();
    // Once the deadline has answered, a late failure from `work` (the destroyed
    // connection's error) has nobody left to tell; it must not surface as an
    // unhandled rejection.
    work.catch(() => undefined);

    try {
      await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
