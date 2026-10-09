import { sql } from 'kysely';
import { createConnection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { waitForLockWaiters } from '../../testing/barrier.js';
import { testDatabase, testDatabaseUrl } from '../../testing/database.js';
import { createUser } from '../../testing/factories.js';
import { newId } from './ids.js';
import { MysqlErrno, mysqlErrno } from './mysql-errors.js';

/** Each code in MysqlErrno, produced by a real statement over the real driver. */
describe('MySQL error numbers, through the real transport', () => {
  const db = testDatabase();
  const caught = (p: Promise<unknown>) =>
    p.then(
      () => undefined,
      (e: unknown) => e,
    );

  it('1062 duplicate key', async () => {
    const user = await createUser(db);
    const err = await caught(
      db.insertInto('users').values({ id: newId(), auth0Id: user.auth0Id, name: 'dup' }).execute(),
    );
    expect(mysqlErrno(err)).toBe(MysqlErrno.DUPLICATE_KEY);
  });

  it('1452 foreign key: the referenced user is gone', async () => {
    const err = await caught(
      db
        .insertInto('notifications')
        .values({ id: newId(), userId: newId(), type: 'general', title: 't' })
        .execute(),
    );
    expect(mysqlErrno(err)).toBe(MysqlErrno.FOREIGN_KEY_MISSING);
  });

  it('3819 check constraint', async () => {
    const user = await createUser(db);
    const err = await caught(
      sql`INSERT INTO certifications (id, user_id, name, issuer, date)
          VALUES (${newId()}, ${user.id}, 'n', 'i', 'banana')`.execute(db),
    );
    expect(mysqlErrno(err)).toBe(MysqlErrno.CHECK_VIOLATED);
  });

  it('1406 data too long', async () => {
    const err = await caught(
      db
        .insertInto('users')
        .values({ id: newId(), auth0Id: 'x'.repeat(256), name: 'n' })
        .execute(),
    );
    expect(mysqlErrno(err)).toBe(MysqlErrno.DATA_TOO_LONG);
  });

  it('1213 deadlock: a competing insert of the same key rolls back', async () => {
    const auth0Id = `deadlock|${newId()}`;
    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('BEGIN');
      await holder.query("INSERT INTO users (id, auth0_id, name) VALUES (UUID(), ?, 'holder')", [
        auth0Id,
      ]);
      const racers = [1, 2].map(() =>
        caught(
          db
            .insertInto('users')
            .values({ id: newId(), auth0Id, name: 'racer' })
            .onDuplicateKeyUpdate({ name: sql`name` })
            .execute(),
        ),
      );
      await waitForLockWaiters(2);
      await holder.query('ROLLBACK');
      const errors = (await Promise.all(racers)).filter((e) => e !== undefined);
      expect(errors.map(mysqlErrno)).toEqual([MysqlErrno.DEADLOCK]);
    } finally {
      await holder.end();
    }
  });
});
