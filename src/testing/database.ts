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
