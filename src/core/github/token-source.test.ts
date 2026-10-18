import { describe, expect, it } from 'vitest';
import { IntegrationUnavailableError } from '../auth0/errors.js';
import type { Auth0Management, ManagementIdentity } from '../auth0/management-client.js';
import { Secret } from '../upstream/secret.js';
import { GithubAccessToken } from './github-access-token.js';
import { Auth0IdpTokenSource } from './token-source.js';

/**
 * The A1 token source over a stand-in Management client: which identity counts,
 * and the in-memory cache's bounds (docs/m7-plan.md §2.2). The client itself
 * runs against a fake tenant over HTTP in management-client.test.ts.
 */
function management(bySub: Record<string, ManagementIdentity[] | null>) {
  const calls: string[] = [];
  const m: Auth0Management = {
    identities: (sub) => {
      calls.push(sub);
      return Promise.resolve(bySub[sub] ?? null);
    },
    linkIdentity: () => Promise.reject(new Error('not used')),
    unlinkIdentity: () => Promise.reject(new Error('not used')),
    deleteUser: () => Promise.reject(new Error('not used')),
  };
  return { m, calls };
}

const github = (id: string, token?: string): ManagementIdentity => ({
  provider: 'github',
  userId: id,
  isSocial: true,
  ...(token === undefined ? {} : { accessToken: new Secret(token) }),
});

describe('Auth0IdpTokenSource', () => {
  it('returns the GitHub identity and its token, wrapped so it prints nothing', async () => {
    const { m } = management({
      'auth0|a': [{ provider: 'auth0', userId: 'a', isSocial: false }, github('7', 'gho_SENTINEL')],
    });
    const found = await new Auth0IdpTokenSource(m, { ttlMs: 1000, maxEntries: 10 }).tokenFor(
      'auth0|a',
    );
    expect(found?.githubUserId).toBe('7');
    expect(found?.token).toBeInstanceOf(GithubAccessToken);
    expect(found?.token.reveal()).toBe('gho_SENTINEL');
    expect(JSON.stringify(found)).not.toContain('gho_SENTINEL');
  });

  it('is null without a social GitHub identity, or without the user', async () => {
    const { m } = management({
      'auth0|plain': [{ provider: 'auth0', userId: 'plain', isSocial: false }],
      'auth0|odd': [
        { provider: 'github', userId: '7', isSocial: false, accessToken: new Secret('t') },
      ],
    });
    const source = new Auth0IdpTokenSource(m, { ttlMs: 1000, maxEntries: 10 });
    expect(await source.tokenFor('auth0|plain')).toBeNull();
    expect(await source.tokenFor('auth0|odd')).toBeNull();
    expect(await source.tokenFor('auth0|gone')).toBeNull();
  });

  it('picks the identity a caller names when a login holds several, and does not serve another from the cache', async () => {
    const { m, calls } = management({
      'auth0|a': [github('7', 'tok7'), github('8', 'tok8')],
    });
    const source = new Auth0IdpTokenSource(m, { ttlMs: 1000, maxEntries: 10 });
    expect((await source.tokenFor('auth0|a'))?.githubUserId).toBe('7');
    // 7 is cached; asking for 8 must not return it.
    const eight = await source.tokenFor('auth0|a', undefined, '8');
    expect([eight?.githubUserId, eight?.token.reveal()]).toEqual(['8', 'tok8']);
    expect(calls).toHaveLength(2);
    expect(await source.tokenFor('auth0|a', undefined, '9')).toBeNull();
  });

  it('caches each wanted identity on its own, and forget drops them all', async () => {
    const { m, calls } = management({ 'auth0|a': [github('7', 'tok7'), github('8', 'tok8')] });
    const source = new Auth0IdpTokenSource(m, { ttlMs: 1000, maxEntries: 10 });
    await source.tokenFor('auth0|a', undefined, '8');
    await source.tokenFor('auth0|a', undefined, '7');
    await source.tokenFor('auth0|a', undefined, '8');
    await source.tokenFor('auth0|a', undefined, '7');
    expect(calls).toHaveLength(2);
    expect(source.size).toBe(2);
    source.forget('auth0|a');
    expect(source.size).toBe(0);
    await source.tokenFor('auth0|a', undefined, '8');
    expect(calls).toHaveLength(3);
  });

  it('a GitHub identity without a token is a configuration fault: 503', async () => {
    const { m } = management({ 'auth0|a': [github('7')] });
    await expect(
      new Auth0IdpTokenSource(m, { ttlMs: 1000, maxEntries: 10 }).tokenFor('auth0|a'),
    ).rejects.toBeInstanceOf(IntegrationUnavailableError);
  });

  it('caches for the TTL, forgets on request, and never caches with a TTL of 0', async () => {
    let now = 0;
    const { m, calls } = management({ 'auth0|a': [github('7', 't')] });
    const source = new Auth0IdpTokenSource(m, { ttlMs: 1000, maxEntries: 10 }, () => now);
    await source.tokenFor('auth0|a');
    now = 999;
    await source.tokenFor('auth0|a');
    expect(calls).toHaveLength(1);
    now = 1000;
    await source.tokenFor('auth0|a');
    expect(calls).toHaveLength(2);
    source.forget('auth0|a');
    await source.tokenFor('auth0|a');
    expect(calls).toHaveLength(3);

    const off = management({ 'auth0|a': [github('7', 't')] });
    const uncached = new Auth0IdpTokenSource(off.m, { ttlMs: 0, maxEntries: 10 });
    await uncached.tokenFor('auth0|a');
    await uncached.tokenFor('auth0|a');
    expect(off.calls).toHaveLength(2);
    expect(uncached.size).toBe(0);
  });

  it('holds at most maxEntries, dropping the oldest first', async () => {
    const bySub = Object.fromEntries(
      ['a', 'b', 'c'].map((k) => [`auth0|${k}`, [github(k === 'a' ? '1' : '2', `t-${k}`)]]),
    );
    const { m, calls } = management(bySub);
    const source = new Auth0IdpTokenSource(m, { ttlMs: 60_000, maxEntries: 2 });
    await source.tokenFor('auth0|a');
    await source.tokenFor('auth0|b');
    await source.tokenFor('auth0|c');
    expect(source.size).toBe(2);
    calls.length = 0;
    await source.tokenFor('auth0|c');
    await source.tokenFor('auth0|b');
    expect(calls).toEqual([]);
    await source.tokenFor('auth0|a');
    expect(calls).toEqual(['auth0|a']);
  });
});
