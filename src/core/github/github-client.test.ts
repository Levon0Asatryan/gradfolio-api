import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeGithub, type FakeGithub, type UserMode } from '../../testing/fake-github.js';
import { GithubAccessToken } from './github-access-token.js';
import { GITHUB_API_VERSION, GithubClient, mapFailure } from './github-client.js';
import {
  GithubNotLinkedError,
  GithubRateLimitedError,
  GithubRevokeFailedError,
  GithubUnavailableError,
} from './errors.js';

/**
 * The GitHub client against a fake GitHub over real HTTP, with GitHub's own
 * status codes and header names: every row of the error table (docs/m7-plan.md
 * §3.1, §10) and the grant delete (§2.5).
 */
describe('GithubClient', () => {
  let gh: FakeGithub;
  let client: GithubClient;
  const token = new GithubAccessToken('gho_SENTINEL_client');

  beforeAll(async () => {
    gh = await startFakeGithub();
    client = new GithubClient({ baseUrl: gh.baseUrl, timeoutMs: 300 });
  });
  afterAll(() => gh.close());
  beforeEach(() => {
    gh.userMode = 'ok';
    gh.grantStatus = undefined;
    gh.grantHang = false;
    gh.tokens.clear();
    gh.requests.length = 0;
    gh.revoked.length = 0;
    gh.tokens.set('gho_SENTINEL_client', { id: 583231, login: 'ani-p' });
  });

  it('reads who the token belongs to, with the token in the header only and the version pinned', async () => {
    expect(await client.authenticatedUser(token)).toEqual({ id: '583231', login: 'ani-p' });
    const req = gh.requests[0]!;
    expect(req).toMatchObject({
      method: 'GET',
      path: '/user',
      authorization: 'Bearer gho_SENTINEL_client',
      apiVersion: GITHUB_API_VERSION,
      userAgent: 'gradfolio-api',
    });
  });

  it.each<[UserMode | 'revoked', new (...a: never[]) => Error, Record<string, string>?]>([
    ['revoked', GithubNotLinkedError],
    ['rate-limited', GithubRateLimitedError],
    ['secondary-limit', GithubRateLimitedError, { 'Retry-After': '37' }],
    ['status-500', GithubUnavailableError],
    ['status-418', GithubUnavailableError],
    ['hang', GithubUnavailableError],
    ['redirect', GithubUnavailableError],
    ['huge', GithubUnavailableError],
    ['bad-json', GithubUnavailableError],
  ])('GET /user %s -> %o', async (mode, expected, headers) => {
    if (mode === 'revoked') gh.tokens.clear();
    else gh.userMode = mode;
    const err = await client.authenticatedUser(token).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(expected);
    if (headers) expect((err as GithubRateLimitedError).headers).toEqual(headers);
    // No message, log detail or header names the token.
    expect(JSON.stringify(err)).not.toContain('SENTINEL');
    expect(String((err as { logDetail?: string }).logDetail)).not.toContain('SENTINEL');
  });

  it('takes Retry-After from x-ratelimit-reset when the primary limit is spent', async () => {
    gh.userMode = 'rate-limited';
    gh.resetAt = Math.floor(Date.now() / 1000) + 600;
    const err = (await client
      .authenticatedUser(token)
      .catch((e: unknown) => e)) as GithubRateLimitedError;
    const wait = Number(err.headers?.['Retry-After']);
    expect(wait).toBeGreaterThan(590);
    expect(wait).toBeLessThanOrEqual(600);
  });

  it('a 403 that is not a rate limit is GITHUB_UNAVAILABLE', () => {
    const res = { status: 403, headers: new Headers({ 'x-ratelimit-remaining': '10' }), body: {} };
    expect(mapFailure(res)).toBeInstanceOf(GithubUnavailableError);
  });

  describe('deleteGrant', () => {
    it('deletes the grant with the app’s Basic credentials and the token in the body', async () => {
      expect(await client.deleteGrant(gh.clientId, gh.clientSecret, token)).toBe('revoked');
      const req = gh.requests[0]!;
      expect(req.method).toBe('DELETE');
      expect(req.path).toBe(`/applications/${gh.clientId}/grant`);
      expect(req.authorization).toBe(
        `Basic ${Buffer.from(`${gh.clientId}:${gh.clientSecret}`).toString('base64')}`,
      );
      expect(req.body).toEqual({ access_token: 'gho_SENTINEL_client' });
      expect(gh.revoked).toEqual(['gho_SENTINEL_client']);
    });

    it.each([404, 422])('counts %i as already gone', async (status) => {
      gh.grantStatus = status;
      expect(await client.deleteGrant(gh.clientId, gh.clientSecret, token)).toBe('already_gone');
    });

    it('a second delete of the same grant is already gone', async () => {
      await client.deleteGrant(gh.clientId, gh.clientSecret, token);
      expect(await client.deleteGrant(gh.clientId, gh.clientSecret, token)).toBe('already_gone');
    });

    it('anything else fails the revocation: 5xx, timeout, our own credentials refused', async () => {
      gh.grantStatus = 500;
      await expect(client.deleteGrant(gh.clientId, gh.clientSecret, token)).rejects.toBeInstanceOf(
        GithubRevokeFailedError,
      );
      gh.grantStatus = undefined;
      await expect(client.deleteGrant(gh.clientId, 'wrong', token)).rejects.toBeInstanceOf(
        GithubRevokeFailedError,
      );
      gh.grantHang = true;
      await expect(client.deleteGrant(gh.clientId, gh.clientSecret, token)).rejects.toBeInstanceOf(
        GithubRevokeFailedError,
      );
      expect(gh.revoked).toEqual([]);
    });
  });
});
