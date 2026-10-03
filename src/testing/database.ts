import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { createConnection, type Pool } from 'mysql2/promise';
import { createDatabase, type Database } from '../core/db/database.js';
import { REGISTRY_TABLE } from '../core/db/migrator/registry.js';
import { createPool } from '../core/db/pool.js';
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

/** Placeholders: never reached. Tests that verify tokens pass a local JWKS issuer. */
export const TEST_ISSUER = 'https://gradfolio-test.invalid/';
export const TEST_AUDIENCE = 'https://api.gradfolio.test';

export function testConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl(),
    AUTH0_ISSUER_BASE_URL: TEST_ISSUER,
    AUTH0_AUDIENCE: TEST_AUDIENCE,
    ...overrides,
  });
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

let shared: { pool: Pool; db: Database } | undefined;

/**
 * Kysely on the integration database, shared by one test file and closed by
 * the per-file hook in integration-setup.ts.
 */
export function testDatabase(): Database {
  if (!shared) {
    const pool = createPool({ ...testConfig(), DATABASE_POOL_MAX: 5 });
    shared = { pool, db: createDatabase(pool) };
  }
  return shared.db;
}

export async function closeTestDatabase(): Promise<void> {
  const current = shared;
  shared = undefined;
  await current?.pool.end();
}

/**
 * Empties every table except the migration registry. DELETE rather than
 * TRUNCATE: about 10 ms against 180 ms for the 11 baseline tables (plan §8).
 * Foreign key checks are off for this session only, so the order is free.
 */
export async function resetDatabase(db: Database = testDatabase()): Promise<void> {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  try {
    const tables = await sql<{ name: string }>`
      SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
         AND table_name <> ${REGISTRY_TABLE}`.execute(db);
    for (const { name } of tables.rows) await sql`DELETE FROM ${sql.table(name)}`.execute(db);
  } finally {
    await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
  }
}
