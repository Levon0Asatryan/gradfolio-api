import { createConnection } from 'mysql2/promise';
import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { scratchDatabase, testDatabaseUrl } from '../../../testing/database.js';
import { githubConnectHarness } from '../../../testing/github-connect.js';
import { db } from '../../../testing/team.js';
import { up } from '../../../core/db/migrator/runner.js';
import { loadMigrations } from '../../../core/db/migrator/files.js';
import { createPool } from '../../../core/db/pool.js';
import { testConfig } from '../../../testing/database.js';

/**
 * The deletion tombstone, the precondition of `AUTH0_DELETE_USERS`
 * (docs/modules/m7/plan.md §2.8, M7-T23): a token issued before the deletion
 * cannot provision a blank, public account for a deleted login.
 */

const h = githubConnectHarness();
const TTL_S = 600;
const on = () => ({
  ...h.env(),
  AUTH0_DELETE_USERS: 'true',
  ACCOUNT_TOMBSTONE_TTL_S: String(TTL_S),
});

const usersOf = (sub: string) =>
  db.selectFrom('users').select('id').where('auth0Id', '=', sub).execute();
const tombstones = () => db.selectFrom('deletedSubjects').selectAll().execute();

beforeEach(async () => {
  await db.deleteFrom('deletedSubjects').execute();
});

describe('a deleted account is not provisioned again by its token', () => {
  it('is refused with 401 and no row, for the lifetime of the tombstone', async () => {
    const http = await h.start(on());
    const s = await h.student('auth0|tomb-refused');
    await http.get('/v1/me').set(s.auth).expect(200);
    const before = Date.now();
    await http.delete('/v1/me').set(s.auth).expect(204);

    const [entry] = await tombstones();
    expect(entry?.auth0Id).toBe(s.sub);
    const left = (entry?.expiresAt.getTime() ?? 0) - before;
    expect(left).toBeGreaterThan((TTL_S - 30) * 1000);
    expect(left).toBeLessThan((TTL_S + 30) * 1000);

    const res = await http.get('/v1/me').set(s.auth).expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(await usersOf(s.sub)).toEqual([]);
    // Again: still refused, still nothing created.
    await http.get('/v1/me').set(s.auth).expect(401);
    expect(await usersOf(s.sub)).toEqual([]);
  });

  it('refuses every route that provisions, not only /v1/me', async () => {
    const http = await h.start(on());
    const s = await h.student('auth0|tomb-routes');
    await http.delete('/v1/me').set(s.auth).expect(204);
    await http.get('/v1/me/projects').set(s.auth).expect(401);
    await http.get('/v1/me/integrations').set(s.auth).expect(401);
    expect(await usersOf(s.sub)).toEqual([]);
  });

  it('leaves everyone else alone', async () => {
    const http = await h.start(on());
    const gone = await h.student('auth0|tomb-gone');
    const other = await h.student('auth0|tomb-other');
    await http.delete('/v1/me').set(gone.auth).expect(204);
    await http.get('/v1/me').set(other.auth).expect(200);
    const fresh = await h.tenant.sign({ sub: 'auth0|tomb-never-seen' });
    await http
      .get('/v1/me')
      .set({ Authorization: `Bearer ${fresh}` })
      .expect(200);
  });

  it('stops refusing once the entry has expired', async () => {
    const http = await h.start(on());
    const s = await h.student('auth0|tomb-expired');
    await http.delete('/v1/me').set(s.auth).expect(204);
    await http.get('/v1/me').set(s.auth).expect(401);
    await db
      .updateTable('deletedSubjects')
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where('auth0Id', '=', s.sub)
      .execute();
    await http.get('/v1/me').set(s.auth).expect(200);
    expect(await usersOf(s.sub)).toHaveLength(1);
  });

  it('the next deletion purges expired entries and keeps live ones', async () => {
    const http = await h.start(on());
    await db
      .insertInto('deletedSubjects')
      .values([
        { auth0Id: 'auth0|stale', expiresAt: new Date(Date.now() - 1000) },
        { auth0Id: 'auth0|live', expiresAt: new Date(Date.now() + 600_000) },
      ])
      .execute();
    const s = await h.student('auth0|tomb-purge');
    await http.delete('/v1/me').set(s.auth).expect(204);
    expect((await tombstones()).map((r) => r.auth0Id).sort()).toEqual([s.sub, 'auth0|live'].sort());
  });

  it('a deletion that is refused lists nothing', async () => {
    const http = await h.start(on());
    const s = await h.student('auth0|tomb-refused-delete');
    h.linkedAtAuth0(s.sub, '140', 'kept');
    await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
    h.gh.grantStatus = 503;
    await http.delete('/v1/me').set(s.auth).expect(502);
    expect(await tombstones()).toEqual([]);
    await http.get('/v1/me').set(s.auth).expect(200);
  });

  it('with the flag off the entry is written but never read: the token still recreates a blank account (Q7)', async () => {
    const http = await h.start(h.env());
    const s = await h.student('auth0|tomb-off');
    await http.delete('/v1/me').set(s.auth).expect(204);
    expect((await tombstones()).map((r) => r.auth0Id)).toEqual([s.sub]);
    await http.get('/v1/me').set(s.auth).expect(200);
    expect(await usersOf(s.sub)).toHaveLength(1);
  });

  it('provisioning racing the deletion never leaves a row (barrier)', async () => {
    const http = await h.start(on());
    const sub = `auth0|tomb-race-${newId()}`;
    const token = await h.tenant.sign({ sub });
    const auth = { Authorization: `Bearer ${token}` };

    // The account exists in a transaction that has not committed: the request
    // below finds no row to read.
    const deleting = await createConnection({ uri: testDatabaseUrl() });
    try {
      await deleting.query('START TRANSACTION');
      await deleting.query(`INSERT INTO users (id, auth0_id, name) VALUES (?, ?, 'Racing')`, [
        newId(),
        sub,
      ]);
      // It provisions, and its insert queues behind that row ...
      const provisioning = http
        .get('/v1/me')
        .set(auth)
        .then((r) => r);
      await waitForLockWaiters(1);
      // ... and the deletion (row removed, subject listed) commits first.
      await deleting.query('DELETE FROM users WHERE auth0_id = ?', [sub]);
      await deleting.query(
        'INSERT INTO deleted_subjects (auth0_id, expires_at) VALUES (?, NOW() + INTERVAL 600 SECOND)',
        [sub],
      );
      await deleting.query('COMMIT');

      const res = await provisioning;
      expect(res.status).toBe(401);
      expect((res.body as { code: string }).code).toBe('UNAUTHENTICATED');
    } finally {
      await deleting.end();
    }
    expect(await usersOf(sub)).toEqual([]);
  });
});

describe('starting with AUTH0_DELETE_USERS on', () => {
  it('is refused while the tombstone table does not exist, and allowed once it does', async () => {
    const scratch = await scratchDatabase();
    const pool = createPool({ ...testConfig(), DATABASE_URL: scratch.url, DATABASE_POOL_MAX: 2 });
    const conn = await pool.getConnection();
    try {
      const migrations = await loadMigrations();
      const opts = { migrations, report: () => undefined, lockTimeoutS: 5 };
      await up(conn, opts, '0009_suggestions');
      await expect(h.start({ ...on(), DATABASE_URL: scratch.url })).rejects.toThrow(
        /deleted_subjects table is missing/,
      );
      await up(conn, opts);
      await h.start({ ...on(), DATABASE_URL: scratch.url });
    } finally {
      conn.release();
      await pool.end();
      await scratch.drop();
    }
  });

  it('does not check for it while the flag is off', async () => {
    const scratch = await scratchDatabase();
    const pool = createPool({ ...testConfig(), DATABASE_URL: scratch.url, DATABASE_POOL_MAX: 2 });
    const conn = await pool.getConnection();
    try {
      const opts = { migrations: await loadMigrations(), report: () => undefined, lockTimeoutS: 5 };
      await up(conn, opts, '0009_suggestions');
      await h.start({ ...h.env(), DATABASE_URL: scratch.url });
    } finally {
      conn.release();
      await pool.end();
      await scratch.drop();
    }
  });
});
