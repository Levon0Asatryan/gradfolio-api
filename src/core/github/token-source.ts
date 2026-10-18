import { IntegrationUnavailableError } from '../auth0/errors.js';
import type { Auth0Management } from '../auth0/management-client.js';
import { GithubAccessToken } from './github-access-token.js';

/** The caller's GitHub identity as Auth0 holds it. */
export interface GithubIdentity {
  /** GitHub's numeric user id, as a string. */
  githubUserId: string;
  token: GithubAccessToken;
}

/**
 * Where a user's GitHub token comes from (docs/m7-plan.md §2.2, D1). Built as
 * A1 (`Auth0IdpTokenSource`); A2 (Token Vault) would be a second implementation
 * behind the same interface.
 */
export interface GithubTokenSource {
  /** The caller's GitHub identity and token; null when no GitHub identity is linked. */
  tokenFor(
    auth0Sub: string,
    signal?: AbortSignal,
    githubUserId?: string,
  ): Promise<GithubIdentity | null>;
  /** Drops what is cached for `auth0Sub` (disconnect, a GitHub 401, account deletion). */
  forget(auth0Sub: string): void;
}

export interface TokenCacheSettings {
  /** 0 turns the cache off. */
  ttlMs: number;
  maxEntries: number;
}

/**
 * A1: the token Auth0 stored at the user's last GitHub login, read with the
 * Management API (`read:user_idp_tokens`). Kept in memory for at most
 * GITHUB_TOKEN_CACHE_S, at most GITHUB_TOKEN_CACHE_MAX entries (the oldest goes
 * first), never persisted (D2). Only an identity with `provider` `github` and
 * `isSocial` counts.
 */
/** One cache entry per (login, wanted GitHub id); no id wanted is its own entry. */
const cacheKey = (auth0Sub: string, githubUserId: string | undefined) =>
  `${auth0Sub}\n${githubUserId ?? ''}`;

export class Auth0IdpTokenSource implements GithubTokenSource {
  private readonly cache = new Map<string, { identity: GithubIdentity; expiresAt: number }>();

  constructor(
    private readonly management: Auth0Management,
    private readonly settings: TokenCacheSettings,
    private readonly now: () => number = Date.now,
  ) {}

  async tokenFor(
    auth0Sub: string,
    signal?: AbortSignal,
    githubUserId?: string,
  ): Promise<GithubIdentity | null> {
    // A login can hold more than one GitHub identity. A caller that names one gets
    // that one (and its own cache entry); one that does not gets the first.
    const key = cacheKey(auth0Sub, githubUserId);
    const hit = this.cache.get(key);
    if (hit && this.now() < hit.expiresAt) return hit.identity;
    this.cache.delete(key);

    const identities = await this.management.identities(auth0Sub, signal);
    const github = identities?.find(
      (i) =>
        i.provider === 'github' &&
        i.isSocial &&
        (githubUserId === undefined || i.userId === githubUserId),
    );
    if (github === undefined) return null;
    if (github.accessToken === undefined) {
      // The identity is there but Auth0 gave no token: the M2M app lacks
      // `read:user_idp_tokens`. A configuration fault, not the user's.
      throw new IntegrationUnavailableError('github identity without a token');
    }
    const identity: GithubIdentity = {
      githubUserId: github.userId,
      token: new GithubAccessToken(github.accessToken.reveal()),
    };
    this.remember(key, identity);
    return identity;
  }

  /** Drops every identity cached for the login (disconnect, a GitHub 401, account deletion). */
  forget(auth0Sub: string): void {
    const prefix = `${auth0Sub}\n`;
    for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key);
  }

  /** How many tokens are held now (tests). */
  get size(): number {
    return this.cache.size;
  }

  private remember(key: string, identity: GithubIdentity): void {
    if (this.settings.ttlMs <= 0) return;
    this.cache.set(key, { identity, expiresAt: this.now() + this.settings.ttlMs });
    // A Map iterates in insertion order: the first key is the oldest entry.
    while (this.cache.size > this.settings.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
