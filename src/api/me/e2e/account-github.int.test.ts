import { describe, expect, it } from 'vitest';
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
});
