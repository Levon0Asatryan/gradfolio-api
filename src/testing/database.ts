import { randomBytes } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import { loadConfig, type AppConfig } from '../core/config/index.js';

/**
 * The database the integration suite runs against.
 *
 * `docker compose up -d mysql` locally; a service container in CI. Never the
 * development database: the suite writes to it.
 */
export function testDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ?? 'mysql://gradfolio:gradfolio@127.0.0.1:3307/gradfolio_test'
  );
}

export function testConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({ NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl(), ...overrides });
}

/**
 * A privileged account on the same server: creates and drops the throwaway
 * databases migration tests run in (the app user may not create databases).
 * Root on the local compose MySQL; CI sets it to its service container.
 */
export function adminDatabaseUrl(): string {
  return process.env.TEST_ADMIN_DATABASE_URL ?? 'mysql://root:root@127.0.0.1:3307';
}

export interface ScratchDatabase {
  name: string;
  /** Admin credentials, this database selected. */
  url: string;
  drop: () => Promise<void>;
}

/**
 * An empty database of its own, for a test that must start from nothing
 * (migrations) or leave nothing behind. Drop it in `afterEach`/`afterAll`.
 */
export async function scratchDatabase(): Promise<ScratchDatabase> {
  const name = `gradfolio_scratch_${randomBytes(6).toString('hex')}`;
  const admin = await createConnection({ uri: adminDatabaseUrl() });
  try {
    await admin.query(
      `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await admin.end();
  }
  const url = new URL(adminDatabaseUrl());
  url.pathname = `/${name}`;
  return {
    name,
    url: url.toString(),
    drop: async () => {
      const conn = await createConnection({ uri: adminDatabaseUrl() });
      try {
        await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
      } finally {
        await conn.end();
      }
    },
  };
}
