import { describe, expect, it } from 'vitest';
import { closeTestDatabase, testDatabase } from './database.js';
import { createUser } from './factories.js';

// Runs while the file loads, before any hook: a row left behind, as a previous
// file (or a previous run) would leave it.
await createUser(testDatabase(), { name: 'left behind' });
await closeTestDatabase();

describe('the per-file reset (integration-setup.ts)', () => {
  it('starts every file with empty tables, whatever was left before it', async () => {
    const rows = await testDatabase().selectFrom('users').select('name').execute();
    expect(rows).toEqual([]);
  });
});
