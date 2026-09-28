import type { RowDataPacket } from 'mysql2/promise';
import { afterEach, describe, expect, it } from 'vitest';
import { testConfig } from '../../testing/database.js';
import { createPool, SESSION_TIME_ZONE } from './pool.js';

type Pool = ReturnType<typeof createPool>;

describe('createPool against MySQL 8.4', () => {
  let pool: Pool | undefined;

  afterEach(async () => {
    await pool?.end();
    pool = undefined;
  });

  it('pins the session time zone on every new connection, before its first query', async () => {
    pool = createPool({ ...testConfig(), DATABASE_POOL_MAX: 4 });

    // Four connections held at once, so each is a fresh one, and each one's
    // very first statement reads the zone.
    const conns = await Promise.all([1, 2, 3, 4].map(() => pool!.getConnection()));
    try {
      const zones = await Promise.all(
        conns.map(async (c) => {
          const [rows] = await c.query<RowDataPacket[]>('SELECT @@session.time_zone AS tz');
          return rows[0]?.tz as string;
        }),
      );
      expect(zones).toEqual([
        SESSION_TIME_ZONE,
        SESSION_TIME_ZONE,
        SESSION_TIME_ZONE,
        SESSION_TIME_ZONE,
      ]);
    } finally {
      for (const c of conns) c.release();
    }
  });

  it('writes CURRENT_TIMESTAMP in UTC and reads it back as the same instant', async () => {
    pool = createPool(testConfig());

    const before = Date.now();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT CAST(CURRENT_TIMESTAMP AS DATETIME) AS now_dt, UTC_TIMESTAMP() AS utc',
    );
    const after = Date.now();
    const row = rows[0] as { now_dt: Date; utc: Date };

    // Both are DATETIME; with session and driver both on UTC they are the same
    // instant, and that instant is now -- not now shifted by the host's offset.
    expect(row.now_dt.getTime()).toBe(row.utc.getTime());
    expect(row.now_dt.getTime()).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 - 1000);
    expect(row.now_dt.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it('stores and returns Armenian text intact (utf8mb4)', async () => {
    pool = createPool(testConfig());
    const text = 'Ծրագրավորող Երևանից — 🎓';
    const [rows] = await pool.query<RowDataPacket[]>('SELECT ? AS t', [text]);
    expect(rows[0]?.t).toBe(text);
  });
});
