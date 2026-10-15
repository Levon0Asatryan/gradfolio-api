import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeGithub, type FakeGithub, type UserMode } from '../../testing/fake-github.js';
import { GithubAccessToken } from './github-access-token.js';
import {
  GITHUB_API_VERSION,
  GithubClient,
  mapFailure,
  nextPageOf,
  rateLimitOf,
} from './github-client.js';
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

    it('counts 422 as already gone', async () => {
      gh.grantStatus = 422;
      expect(await client.deleteGrant(gh.clientId, gh.clientSecret, token)).toBe('already_gone');
    });

    it('a 404 is not proof of anything: the revocation failed', async () => {
      gh.grantStatus = 404;
      await expect(client.deleteGrant(gh.clientId, gh.clientSecret, token)).rejects.toBeInstanceOf(
        GithubRevokeFailedError,
      );
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

  describe('repositories and README (docs/m7-plan.md §3.2–3.4)', () => {
    const repo = (id: number, over = {}) => ({
      id,
      name: `r${id}`,
      ownerId: 583231,
      ownerLogin: 'ani-p',
      description: 'd',
      language: 'Go',
      stars: 2,
      forks: 1,
      private: false,
      fork: false,
      archived: false,
      defaultBranch: 'main',
      pushedAt: '2026-01-01T00:00:00Z',
      pushers: [],
      readme: '<p>hi</p>',
      readmePath: 'docs/README.md',
      ...over,
    });
    beforeEach(() => {
      gh.repos.clear();
      gh.repoMode = 'ok';
      for (const id of [1, 2, 3]) gh.repos.set(id, repo(id));
    });

    it('lists with the parameters it promises, pages by the Link header, and reads the limit', async () => {
      const page = await client.listRepos(token, { page: 1, perPage: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.items[0]).toMatchObject({ ownerLogin: 'ani-p', canPush: true, stars: 2 });
      expect(page.nextPage).toBe(2);
      expect(page.rateLimit.remaining).toBe(4999);
      expect(page.rateLimit.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const req = gh.requests.at(-1)!;
      expect(req.path).toBe('/user/repos');
      const last = await client.listRepos(token, { page: 2, perPage: 2 });
      expect(last.nextPage).toBeNull();
    });

    it('reads a repository by integer id; 404 is null; a limit or failure is an error', async () => {
      expect((await client.getRepo(token, 2)).repo).toMatchObject({ id: 2, defaultBranch: 'main' });
      expect((await client.getRepo(token, 99)).repo).toBeNull();
      gh.repoMode = 'rate-limited';
      await expect(client.getRepo(token, 2)).rejects.toBeInstanceOf(GithubRateLimitedError);
      gh.repoMode = 'status-500';
      await expect(client.getRepo(token, 2)).rejects.toBeInstanceOf(GithubUnavailableError);
      await expect(client.getRepo(token, 1.5)).rejects.toThrow(/integer/);
      await expect(client.getRepo(token, -3)).rejects.toThrow(/integer/);
    });

    it('reads the README as HTML with its path; none is null; over the cap is too_large', async () => {
      const got = await client.getReadme(token, 1, 10_000);
      expect(got.readme).toMatchObject({ path: 'docs/README.md' });
      expect((got.readme as { html: string }).html).toContain('<p>hi</p>');
      // The README call's own headers, not the repository call's.
      expect(got.rateLimit?.remaining).toBe(4990);
      expect(gh.requests.at(-1)!.path).toBe('/repositories/1/readme');
      gh.repos.get(2)!.readme = null;
      expect((await client.getReadme(token, 2, 10_000)).readme).toBeNull();
      gh.repos.get(3)!.readme = `<p>${'x'.repeat(5000)}</p>`;
      expect(await client.getReadme(token, 3, 1000)).toEqual({
        readme: 'too_large',
        rateLimit: null,
      });
    });

    it('parses Link and rate-limit headers strictly', () => {
      expect(
        nextPageOf('<https://x/user/repos?page=3>; rel="next", <https://x?page=9>; rel="last"'),
      ).toBe(3);
      expect(nextPageOf('<https://x?page=9>; rel="last"')).toBeNull();
      expect(nextPageOf('<https://x?page=abc>; rel="next"')).toBeNull();
      expect(nextPageOf(null)).toBeNull();
      expect(
        rateLimitOf(
          new Headers({ 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '1800000000' }),
        ),
      ).toEqual({ remaining: 12, resetsAt: new Date(1_800_000_000_000).toISOString() });
      expect(rateLimitOf(new Headers({ 'x-ratelimit-remaining': 'x' }))).toEqual({
        remaining: null,
        resetsAt: null,
      });
    });
  });
});
