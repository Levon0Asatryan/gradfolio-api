import { afterAll, beforeAll } from 'vitest';
import { closeTestDatabase, resetDatabase } from './database.js';

/**
 * Runs in every integration test file (vitest.integration.mts `setupFiles`):
 * each file starts from empty tables, whatever the file before it left, without
 * having to opt in.
 */
beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});
