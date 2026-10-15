import { createConnection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testDatabaseUrl } from '../../../testing/database.js';
import { githubConnectHarness, githubRow } from '../../../testing/github-connect.js';
import { db } from '../../../testing/team.js';

/**
 * Deleting an account with a connected GitHub revokes the grant at GitHub
 * first (docs/m7-plan.md D9, §2.5): the token Auth0 holds dies with the
 * account, and a failed revocation deletes nothing.
 */

const h = githubConnectHarness();

describe('account deletion revokes first', () => {
  it('a connected GitHub is revoked at GitHub, then the account is deleted', async () => {
    const http = await h.start();
    const s = await h.student('github|110');
    h.linkedAtAuth0(s.sub, '110', 'gone');
    await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
    await http.delete('/v1/me').set(s.auth).expect(204);
    expect(h.gh.revoked).toEqual([h.auth0.githubTokenFor('110')]);
    expect(await db.selectFrom('users').select('id').where('id', '=', s.id).execute()).toEqual([]);
  });

  it('a failed revocation deletes nothing: 502', async () => {
    const http = await h.start();
    const s = await h.student('github|111');
    h.linkedAtAuth0(s.sub, '111', 'kept');
    await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
    h.gh.grantStatus = 503;
    const res = await http.delete('/v1/me').set(s.auth).expect(502);
    expect(res.body.code).toBe('GITHUB_REVOKE_FAILED');
    expect(await githubRow(s.id)).toMatchObject({ status: 'connected' });
  });

  it('an account without a connected GitHub is deleted without asking anyone', async () => {
    const http = await h.start({});
    const s = await h.student('auth0|plain-delete');
    await http.delete('/v1/me').set(s.auth).expect(204);
    expect(h.auth0.calls).toEqual([]);
    expect(h.gh.requests).toEqual([]);
  });

  it('a connect committed between the revocation check and the user lock stops the deletion (barrier)', async () => {
    const http = await h.start();
    const s = await h.student('github|112');
    h.linkedAtAuth0(s.sub, '112', 'late');

    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [s.id]);
      // The connect has GitHub's answer and waits for the user lock ...
      const connecting = http
        .post('/v1/me/integrations/github/connect')
        .set(s.auth)
        .then((r) => r);
      await waitForLockWaiters(1);
      // ... and the deletion's preflight saw nothing connected, so revoked nothing.
      const deleting = http
        .delete('/v1/me')
        .set(s.auth)
        .then((r) => r);
      await waitForLockWaiters(2);
      await holder.query('COMMIT');

      expect((await connecting).status).toBe(200);
      const res = await deleting;
      expect(res.status).toBe(409);
      expect((res.body as { code: string }).code).toBe('GITHUB_STATE_CHANGED');
    } finally {
      await holder.end();
    }
    // Nothing was deleted, and the grant made by that connect is not orphaned:
    expect(await githubRow(s.id)).toMatchObject({ status: 'connected' });
    expect(h.gh.revoked).toEqual([]);
    // The retry revokes it, then deletes.
    await http.delete('/v1/me').set(s.auth).expect(204);
    expect(h.gh.revoked).toEqual([h.auth0.githubTokenFor('112')]);
    expect(await db.selectFrom('users').select('id').where('id', '=', s.id).execute()).toEqual([]);
  });

  it('a link still in flight stops the deletion without revoking or deleting anything (barrier on Auth0’s link)', async () => {
    const http = await h.start();
    const s = await h.student('auth0|delete-linking');
    h.githubKnows('113', 'inflight');
    const token = await h.idToken('113', await h.nonceFor(http, s));
    const gate = h.auth0.holdNextLink();
    const linking = http
      .post('/v1/me/integrations/github/link')
      .set(s.auth)
      .send({ idToken: token })
      .then((r) => r);
    await gate.arrived;
    expect(await githubRow(s.id)).toMatchObject({ status: 'linking', externalUserId: '113' });

    const asked = h.auth0.calls.length;
    const res = await http.delete('/v1/me').set(s.auth);
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('GITHUB_LINK_IN_PROGRESS');
    // Nothing asked of Auth0 or GitHub for a revocation, and the account stands.
    expect(h.auth0.calls.length).toBe(asked);
    expect(h.gh.requests.filter((r) => r.method === 'DELETE')).toEqual([]);
    expect(await db.selectFrom('users').select('id').where('id', '=', s.id).execute()).toHaveLength(
      1,
    );

    // The link then completes, and the retry revokes what it made before deleting.
    gate.release();
    expect((await linking).status).toBe(200);
    await http.delete('/v1/me').set(s.auth).expect(204);
    expect(h.gh.revoked).toEqual([h.auth0.githubTokenFor('113')]);
  });

  it('a link that reserved after the preflight stops the deletion at the user lock (barrier)', async () => {
    const http = await h.start();
    const s = await h.student('auth0|delete-late-link');
    h.githubKnows('114', 'late-link');
    const token = await h.idToken('114', await h.nonceFor(http, s));
    const gate = h.auth0.holdNextLink();

    const holder = await createConnection({ uri: testDatabaseUrl() });
    try {
      await holder.query('START TRANSACTION');
      await holder.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [s.id]);
      // The link queues for the user lock first ...
      const linking = http
        .post('/v1/me/integrations/github/link')
        .set(s.auth)
        .send({ idToken: token })
        .then((r) => r);
      await waitForLockWaiters(1);
      // ... then the deletion, whose preflight found no GitHub row to revoke.
      const deleting = http
        .delete('/v1/me')
        .set(s.auth)
        .then((r) => r);
      await waitForLockWaiters(2);
      await holder.query('COMMIT');

      // The link reserved and is at Auth0 (held); the deletion got the lock behind it.
      await gate.arrived;
      const res = await deleting;
      expect(res.status).toBe(409);
      expect((res.body as { code: string }).code).toBe('GITHUB_LINK_IN_PROGRESS');
      gate.release();
      expect((await linking).status).toBe(200);
    } finally {
      await holder.end();
    }
    expect(await githubRow(s.id)).toMatchObject({ status: 'connected' });
  });
});
