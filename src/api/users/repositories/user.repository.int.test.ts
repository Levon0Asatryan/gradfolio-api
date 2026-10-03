import { createConnection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testDatabase, testDatabaseUrl } from '../../../testing/database.js';
import type { UserPrefill } from '../utils/prefill.js';
import { findByAuth0Id, setVerified, upsertByAuth0Id } from './user.repository.js';

/** First-login provisioning on MySQL 8.4 (docs/m2-plan.md §2.5, §3.4). */

const prefill = (over: Partial<UserPrefill> = {}): UserPrefill => ({
  name: 'Ani',
  email: 'ani@example.com',
  avatarUrl: 'https://example.com/a.png',
  headline: '',
  verified: true,
  ...over,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('users repository', () => {
  const db = testDatabase();

  it('creates the row with an id the app generated, and the pre-filled fields', async () => {
    const sub = `google-oauth2|${newId()}`;
    const row = await inTransaction(db, (trx) => upsertByAuth0Id(trx, sub, prefill()));

    expect(row.id).toMatch(UUID);
    expect(row).toMatchObject({
      auth0Id: sub,
      name: 'Ani',
      email: 'ani@example.com',
      avatarUrl: 'https://example.com/a.png',
      verified: true,
      isPublic: true,
    });
    expect(await findByAuth0Id(db, sub)).toEqual(row);
  });

  it('never overwrites an existing row: a login keeps what the user edited', async () => {
    const sub = `auth0|${newId()}`;
    const first = await inTransaction(db, (trx) => upsertByAuth0Id(trx, sub, prefill()));
    const again = await inTransaction(db, (trx) =>
      upsertByAuth0Id(trx, sub, prefill({ name: 'Somebody Else', email: 'x@y.z' })),
    );
    expect(again.id).toBe(first.id);
    expect(again.name).toBe('Ani');
    expect(again.email).toBe('ani@example.com');
  });

  it('returns a competitor’s committed row even to a transaction that read before it', async () => {
    const sub = `auth0|${newId()}`;
    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      const holderId = newId();
      await holder.query('BEGIN');
      await holder.query("INSERT INTO users (id, auth0_id, name) VALUES (?, ?, 'holder')", [
        holderId,
        sub,
      ]);
      const ours = db.transaction().execute(async (trx) => {
        // A read first: this transaction now holds a REPEATABLE READ snapshot
        // from before the competitor commits.
        await trx.selectFrom('users').select('id').execute();
        return upsertByAuth0Id(trx, sub, prefill());
      });
      await waitForLockWaiters(1);
      await holder.query('COMMIT');
      // A plain re-read would see the old snapshot and find no row (run).
      expect((await ours).id).toBe(holderId);
    } finally {
      await holder.end();
    }
  });

  it.each(['commit', 'rollback'] as const)(
    'gives two concurrent first logins one row and one id when a competitor %ss (barrier)',
    async (outcome) => {
      const sub = `auth0|${newId()}`;
      const holder = await createConnection({ uri: testDatabaseUrl() });
      try {
        const holderId = newId();
        await holder.query('BEGIN');
        await holder.query("INSERT INTO users (id, auth0_id, name) VALUES (?, ?, 'holder')", [
          holderId,
          sub,
        ]);
        const racers = [1, 2].map(() =>
          inTransaction(db, (trx) => upsertByAuth0Id(trx, sub, prefill())),
        );
        await waitForLockWaiters(2);
        await holder.query(outcome === 'commit' ? 'COMMIT' : 'ROLLBACK');
        const ids = new Set((await Promise.all(racers)).map((row) => row.id));

        expect(ids.size).toBe(1);
        if (outcome === 'commit') expect([...ids]).toEqual([holderId]);
        const rows = await db.selectFrom('users').select('id').where('auth0Id', '=', sub).execute();
        expect(rows).toHaveLength(1);
      } finally {
        await holder.end();
      }
    },
  );

  it('syncs verified both ways, and only changes the row it names', async () => {
    const sub = `auth0|${newId()}`;
    const other = `auth0|${newId()}`;
    const row = await inTransaction(db, (trx) =>
      upsertByAuth0Id(trx, sub, prefill({ verified: false })),
    );
    await inTransaction(db, (trx) => upsertByAuth0Id(trx, other, prefill({ verified: false })));

    await setVerified(db, row.id, true);
    expect((await findByAuth0Id(db, sub))?.verified).toBe(true);
    expect((await findByAuth0Id(db, other))?.verified).toBe(false);
    await setVerified(db, row.id, false);
    expect((await findByAuth0Id(db, sub))?.verified).toBe(false);
  });
});
