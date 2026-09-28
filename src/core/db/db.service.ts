import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/schema.js';
import { createPool } from './pool.js';

/**
 * Owns the MySQL pool for the process lifetime.
 *
 * The query layer on top of it (query builder or ORM) is an M0 decision; until
 * then this exposes the pool and a liveness query.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    // Lazy: mysql2 opens connections on first use, so constructing the app
    // does not need a reachable database -- readiness reports that instead.
    this.pool = createPool(cfg);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
