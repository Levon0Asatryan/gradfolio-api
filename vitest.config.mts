import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts', 'node_modules/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // The entrypoint is wiring: CI's container-stack job boots it for real,
        // and mocking Nest's bootstrap to reach it would test the mock.
        'src/api/main.ts',
        'src/**/*.module.ts',
        // argv in, a file out. What it writes is covered by document.test.ts,
        // and that the committed file matches by `openapi:check` in CI.
        'src/api/openapi/cli.ts',
        // Database behaviour: the session time zone on every connection and
        // real driver errors. Covered by pool.int.test.ts and
        // database-unavailable.int.test.ts against a real MySQL 8.4, which CI
        // runs as its own job. A unit test would assert against a mocked pool.
        'src/core/db/pool.ts',
        'src/core/db/db.service.ts',
        // Test-only helpers, never shipped.
        'src/testing/**',
      ],
      // A ratchet, not an aspiration: at or just below what the suite
      // achieves, so coverage cannot silently fall. Raise it as milestones land.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
