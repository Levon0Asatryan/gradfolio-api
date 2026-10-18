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

  describe('the Auth0 side of the account (docs/m7-plan.md §2.7)', () => {
    const identitiesOf = (sub: string) =>
      (h.auth0.users.get(sub) ?? []).map((i) => `${i.provider}:${i.user_id}`);
    const unlinks = () => h.auth0.calls.filter((c) => c.method === 'DELETE');

    it('deleting the account unlinks the GitHub identity, and reconnecting then works as the first time', async () => {
      const http = await h.start();
      const s = await h.student('auth0|unlink-me');
      h.githubKnows('120', 'back-again');
      // Linked the normal way: a secondary sign-in, then the link.
      const token = await h.idToken('120', await h.nonceFor(http, s));
      await http
        .post('/v1/me/integrations/github/link')
        .set(s.auth)
        .send({ idToken: token })
        .expect(200);
      expect(identitiesOf(s.sub)).toContain('github:120');

      await http.delete('/v1/me').set(s.auth).expect(204);
      expect(h.gh.revoked).toEqual([h.auth0.githubTokenFor('120')]);
      // Unlinked at Auth0 (the former secondary is a standalone user again), before the data went.
      expect(identitiesOf(s.sub)).not.toContain('github:120');
      expect(identitiesOf('github|120')).toEqual(['github:120']);
      expect(unlinks()).toHaveLength(1);
      expect(unlinks()[0]!.path).toBe('/api/v2/users/auth0%7Cunlink-me/identities/github/120');
      expect(await db.selectFrom('users').select('id').where('id', '=', s.id).execute()).toEqual(
        [],
      );

      // The same login comes back (Q7: a blank account) and connects GitHub as if for the first time.
      const again = await h.student('auth0|unlink-me');
      h.githubKnows('120', 'back-again');
      const nonce = await h.nonceFor(http, again);
      const relink = await http
        .post('/v1/me/integrations/github/link')
        .set(again.auth)
        .send({ idToken: await h.idToken('120', nonce) })
        .expect(200);
      expect(relink.body).toMatchObject({ state: 'connected', login: 'back-again' });
    });

    it('a failed unlink stops the deletion: 503, nothing deleted, the identity still there', async () => {
      const http = await h.start();
      const s = await h.student('github-primary-not');
      h.linkedAtAuth0(s.sub, '121', 'kept');
      h.auth0.unlinkStatus = 500;
      const res = await http.delete('/v1/me').set(s.auth).expect(503);
      expect(res.body.code).toBe('INTEGRATION_UNAVAILABLE');
      expect(
        await db.selectFrom('users').select('id').where('id', '=', s.id).execute(),
      ).toHaveLength(1);
      expect(identitiesOf(s.sub)).toContain('github:121');
      h.auth0.unlinkStatus = undefined;
      await http.delete('/v1/me').set(s.auth).expect(204);
      expect(identitiesOf(s.sub)).not.toContain('github:121');
    });

    it('an identity Auth0 no longer has (404) is success', async () => {
      const http = await h.start();
      const s = await h.student('auth0|gone-at-auth0');
      h.linkedAtAuth0(s.sub, '122', 'gone');
      h.auth0.unlinkStatus = 404;
      await http.delete('/v1/me').set(s.auth).expect(204);
    });

    it('a login that is the GitHub one has nothing linked to unlink', async () => {
      const http = await h.start();
      const s = await h.student('github|123');
      h.linkedAtAuth0(s.sub, '123', 'primary');
      await http.delete('/v1/me').set(s.auth).expect(204);
      expect(unlinks()).toEqual([]);
    });

    it('an account that never linked GitHub asks Auth0 once and unlinks nothing', async () => {
      const http = await h.start();
      const s = await h.student('auth0|never-linked');
      await http.delete('/v1/me').set(s.auth).expect(204);
      expect(h.auth0.calls.filter((c) => c.path.startsWith('/api/v2/'))).toHaveLength(1);
      expect(unlinks()).toEqual([]);
    });
  });
});
