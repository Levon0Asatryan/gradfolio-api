import { afterEach, describe, expect, it } from 'vitest';
import { testConfig } from '../../testing/database.js';
import { DbService } from './db.service.js';

describe('DbService.queryWithin against MySQL 8.4', () => {
  let db: DbService | undefined;

  afterEach(async () => {
    await db?.onModuleDestroy();
    db = undefined;
  });

  it('frees the connection at the deadline instead of leaving the query running', async () => {
    // One connection: if the timed-out query kept it, the next query would
    // wait for the server-side SLEEP to finish (~3 s).
    db = new DbService(testConfig({ DATABASE_POOL_MAX: '1' }));
    await db.ping(2000);

    const started = Date.now();
    await expect(db.queryWithin('SELECT SLEEP(3)', 300)).rejects.toThrow(/exceeded 300ms/);
    expect(Date.now() - started).toBeLessThan(1000);

    const next = Date.now();
    await db.ping(2000);
    expect(Date.now() - next).toBeLessThan(1000);
  });

  it('answers within the deadline when the pool is exhausted, and does not keep the late connection', async () => {
    db = new DbService(testConfig({ DATABASE_POOL_MAX: '1' }));
    const holder = await db.pool.getConnection();
    try {
      await expect(db.ping(300)).rejects.toThrow(/exceeded 300ms/);
    } finally {
      holder.release();
    }
    // The waiter that got the connection after its deadline released it unused.
    await db.ping(2000);
  });

  it('resolves normally well inside the deadline', async () => {
    db = new DbService(testConfig());
    await expect(db.ping(2000)).resolves.toBeUndefined();
  });
});
