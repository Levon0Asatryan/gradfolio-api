import { defineConfig } from 'vitest/config';

/**
 * Integration tests. They need a real MySQL 8.4 (`docker compose up -d mysql`
 * locally, a service container in CI); the unit suite needs nothing and stays
 * fast. Behaviour that depends on MySQL is never tested against a stand-in.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    environment: 'node',
    // One database, so files must not interleave their writes.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
