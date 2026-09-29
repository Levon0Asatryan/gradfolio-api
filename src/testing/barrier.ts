import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { adminDatabaseUrl } from './database.js';

/**
 * Waits until `count` sessions on the server are blocked on an InnoDB lock --
 * the barrier for race tests: start the competing statements, wait here until
 * they are provably queued behind the lock, then release it. Never a sleep.
 *
 * Reads performance_schema.data_lock_waits, which the app user may not
 * (1142), so it uses the admin connection.
 */
export async function waitForLockWaiters(count: number, attempts = 500): Promise<void> {
  const admin = await createConnection({ uri: adminDatabaseUrl() });
  try {
    for (let i = 0; i < attempts; i++) {
      const [rows] = await admin.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits',
      );
      if (Number(rows[0]?.n) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`never saw ${count} lock waiter(s)`);
  } finally {
    await admin.end();
  }
}
