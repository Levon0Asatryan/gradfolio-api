import { sql } from 'kysely';
import { createConnection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { waitForLockWaiters } from '../../testing/barrier.js';
import { testDatabase, testDatabaseUrl } from '../../testing/database.js';
import { newId } from './ids.js';
import { MysqlErrno, mysqlErrno } from './mysql-errors.js';
import { inTransaction } from './transaction.js';

describe('inTransaction', () => {
  const db = testDatabase();

  /**
   * Two first-login upserts of one auth0_id race behind a third session that
   * inserted it and then rolls back: InnoDB makes one of them the deadlock
   * victim. Returns each racer's result: the attempts it took, or its error.
   */
  async function raceUpserts(maxAttempts: number) {
    const auth0Id = `race|${newId()}`;
    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('BEGIN');
      await holder.query("INSERT INTO users (id, auth0_id, name) VALUES (UUID(), ?, 'holder')", [
        auth0Id,
      ]);
      const racers = [1, 2].map(async () => {
        let attempts = 0;
        try {
          const id = await inTransaction(
            db,
            async (trx) => {
              attempts++;
              await trx
                .insertInto('users')
                .values({ id: newId(), auth0Id, name: 'racer' })
                .onDuplicateKeyUpdate({ name: sql`name` })
                .execute();
              const row = await trx
                .selectFrom('users')
                .select('id')
                .where('auth0Id', '=', auth0Id)
                .forShare()
                .executeTakeFirstOrThrow();
              return row.id;
            },
            { maxAttempts },
          );
          return { attempts, id };
        } catch (error) {
          return { attempts, error };
        }
      });
      await waitForLockWaiters(2);
      await holder.query('ROLLBACK');
      return { auth0Id, results: await Promise.all(racers) };
    } finally {
      await holder.end();
    }
  }

  it('retries the deadlock victim, and both callers get the one row', async () => {
    const { auth0Id, results } = await raceUpserts(3);
    expect(results.every((r) => 'id' in r)).toBe(true);
    expect(results.map((r) => r.attempts).sort()).toEqual([1, 2]);
    const rows = await db.selectFrom('users').select('id').where('auth0Id', '=', auth0Id).execute();
    expect(rows).toHaveLength(1);
    expect(results.map((r) => ('id' in r ? r.id : undefined))).toEqual([rows[0]!.id, rows[0]!.id]);
  });

  it('gives up after maxAttempts and surfaces the 1213', async () => {
    const { results } = await raceUpserts(1);
    const failed = results.filter((r) => 'error' in r);
    expect(failed).toHaveLength(1);
    expect(mysqlErrno(failed[0] && 'error' in failed[0] ? failed[0].error : undefined)).toBe(
      MysqlErrno.DEADLOCK,
    );
  });

  it('does not retry other errors, and rolls back what the attempt wrote', async () => {
    const id = newId();
    let attempts = 0;
    await expect(
      inTransaction(db, async (trx) => {
        attempts++;
        await trx
          .insertInto('users')
          .values({ id, auth0Id: `t|${id}`, name: 'n' })
          .execute();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(attempts).toBe(1);
    expect(await db.selectFrom('users').select('id').where('id', '=', id).execute()).toEqual([]);
  });
});
