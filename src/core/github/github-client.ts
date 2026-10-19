import { z } from 'zod';
import {
  retryAfterSeconds,
  upstreamRequest,
  UpstreamFailure,
  type UpstreamRequest,
  type UpstreamResponse,
} from '../upstream/request.js';
import type { GithubAccessToken } from './github-access-token.js';
import {
  GithubNotLinkedError,
  GithubRateLimitedError,
  GithubRevokeFailedError,
  GithubUnavailableError,
} from './errors.js';

/**
 * GitHub's REST API (docs/modules/m7/plan.md §3.1): the base URL from configuration,
 * no redirects, a deadline, a body cap, the API version pinned, the token in
 * the `Authorization` header only. A caller passes no URL, host or path: each
 * method builds its own from configuration and validated values.
 *
 * Answers map to our errors in one place:
 *
 * | GitHub                                                    | API answer                         |
 * | --------------------------------------------------------- | ---------------------------------- |
 * | 401                                                       | 409 GITHUB_NOT_LINKED              |
 * | 403/429 with `x-ratelimit-remaining: 0`, or `retry-after` | 429 GITHUB_RATE_LIMITED            |
 * | 5xx, timeout, network, an oversized or malformed body     | 502 GITHUB_UNAVAILABLE             |
 * | anything else                                             | 502 GITHUB_UNAVAILABLE (status logged) |
 */

export interface GithubClientSettings {
  /** Ends in `/` (config normalizes it). */
  baseUrl: string;
  timeoutMs: number;
}

export interface GithubUser {
  /** GitHub's numeric user id, as a string. */
  id: string;
  login: string;
}

/**
 * How a grant delete ended without failing: removed now (`revoked`), GitHub
 * says there is none (`already_gone`), or GitHub refused the delete but also
 * refuses the token itself (`token_refused`): the token is dead, which is what
 * revocation is for.
 */
export type RevokeResult = 'revoked' | 'already_gone' | 'token_refused';

/** The API version every request pins (GitHub's `X-GitHub-Api-Version`). */
export const GITHUB_API_VERSION = '2022-11-28';
const MAX_BODY_BYTES = 1024 * 1024;

/** GitHub's rate limit as of the last answer (docs/modules/m7/plan.md §3.1). */
export interface GithubRateLimit {
  remaining: number | null;
  /** ISO 8601, UTC. */
  resetsAt: string | null;
}

/** A GitHub login or repository name: nothing that could change a URL path. */
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

const repoResponse = z.object({
  id: z.number().int().positive(),
  name: z.string().regex(NAME),
  full_name: z.string().min(1).max(200),
  description: z.string().max(10_000).nullable(),
  language: z.string().max(100).nullable(),
  topics: z.array(z.string().max(100)).max(100).default([]),
  stargazers_count: z.number().int().nonnegative(),
  forks_count: z.number().int().nonnegative(),
  html_url: z.string().url().max(500),
  private: z.boolean(),
  fork: z.boolean().default(false),
  archived: z.boolean().default(false),
  default_branch: z.string().min(1).max(250).default('HEAD'),
  pushed_at: z.string().nullable().default(null),
  owner: z.object({ id: z.number().int().positive(), login: z.string().regex(NAME) }),
  permissions: z
    .object({ push: z.boolean().optional(), admin: z.boolean().optional() })
    .partial()
    .optional(),
});

/** What the import reads of a repository; the client's own numbers are never used. */
export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  /** The repository's topics, as GitHub lists them (lower case). */
  topics: string[];
  stars: number;
  forks: number;
  htmlUrl: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  ownerId: number;
  ownerLogin: string;
  /** The caller may push to it (GitHub's `permissions`, present for an authenticated read). */
  canPush: boolean;
}

export interface GithubRepoPage {
  items: GithubRepo[];
  /** The next page number, or null on the last page (from GitHub's `Link` header). */
  nextPage: number | null;
  rateLimit: GithubRateLimit;
}

/** The public profile fields of a GitHub account (docs/modules/m7/plan.md §6.3). Never a token, never an email. */
export interface GithubProfile {
  name: string | null;
  bio: string | null;
  location: string | null;
  company: string | null;
  avatarUrl: string | null;
  blog: string | null;
  htmlUrl: string | null;
}

export type GithubProfileRead =
  | { notModified: true; rateLimit: GithubRateLimit }
  | { notModified: false; profile: GithubProfile; etag: string | null; rateLimit: GithubRateLimit };

const profileResponse = z.object({
  name: z.string().max(2000).nullable().optional(),
  bio: z.string().max(5000).nullable().optional(),
  location: z.string().max(1000).nullable().optional(),
  company: z.string().max(1000).nullable().optional(),
  avatar_url: z.string().max(2000).nullable().optional(),
  blog: z.string().max(2000).nullable().optional(),
  html_url: z.string().max(2000).nullable().optional(),
});

/** One of the account's linked social accounts (`GET /user/social_accounts`): public data. */
export interface GithubSocialAccount {
  provider: string;
  url: string;
}

const socialAccountsResponse = z.array(
  z.object({ provider: z.string().min(1).max(100), url: z.string().max(2000) }),
);

/** A README as GitHub rendered it, with where it lives in the repository. */
export interface GithubReadme {
  html: string;
  /** `README.md`, `docs/README.md`: from the wrapper's `data-path`, validated. */
  path: string;
}

const userResponse = z.object({
  id: z.number().int().positive(),
  // GitHub logins are at most 39 characters; the column holds 100.
  login: z.string().min(1).max(100),
});

/**
 * The status GitHub documents for a grant delete when no grant exists (422);
 * never seen from the real service. What was seen (production, 2026-10-19): for a
 * token GitHub refuses (`GET /user` 401), the delete with valid client credentials
 * answered **404**. A 404 is also what a client id GitHub does not know would get,
 * and reading that as "revoked" would report a disconnect while the token stays
 * alive, so a 4xx other than this list proves nothing alone: `deleteGrant` asks
 * GitHub about the token itself and counts the grant gone only when that is a 401.
 */
export const GRANT_ALREADY_GONE = [422] as const;

/** A 502 like any unavailable answer, but one whose headers are known (the body went over the cap). */
const languagesResponse = z.record(z.string().min(1).max(100), z.number().nonnegative());

class GithubBodyTooLargeError extends GithubUnavailableError {
  constructor(
    cause: string,
    readonly upstreamHeaders: Headers,
  ) {
    super(cause);
  }
}

export class GithubClient {
  constructor(private readonly settings: GithubClientSettings) {}

  /** `GET /user`: who the token belongs to. */
  async authenticatedUser(token: GithubAccessToken): Promise<GithubUser> {
    const res = await this.send('user', {
      method: 'GET',
      headers: { authorization: `Bearer ${token.reveal()}` },
    });
    if (res.status !== 200) throw mapFailure(res);
    const parsed = userResponse.safeParse(res.body);
    if (!parsed.success) throw new GithubUnavailableError('GET /user bad body');
    return { id: String(parsed.data.id), login: parsed.data.login };
  }

  /**
   * `GET /user` again, for the public profile fields. With the `ETag` of the
   * last read it is a conditional request: a `304` costs no rate limit
   * (GitHub's REST best practices) and says nothing changed.
   */
  async getProfile(token: GithubAccessToken, etag: string | null): Promise<GithubProfileRead> {
    const res = await this.send('user', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token.reveal()}`,
        ...(etag === null ? {} : { 'if-none-match': etag }),
      },
    });
    const rateLimit = rateLimitOf(res.headers);
    if (res.status === 304) return { notModified: true, rateLimit };
    if (res.status !== 200) throw mapFailure(res);
    const parsed = profileResponse.safeParse(res.body);
    if (!parsed.success) throw new GithubUnavailableError('GET /user bad profile body');
    const p = parsed.data;
    return {
      notModified: false,
      etag: res.headers.get('etag'),
      rateLimit,
      profile: {
        name: p.name ?? null,
        bio: p.bio ?? null,
        location: p.location ?? null,
        company: p.company ?? null,
        avatarUrl: p.avatar_url ?? null,
        blog: p.blog ?? null,
        htmlUrl: p.html_url ?? null,
      },
    };
  }

  /**
   * `GET /user/social_accounts`: the account's LinkedIn, X, YouTube … links, one
   * call (up to 100 per page; GitHub lists at most four). Public data, no scope.
   */
  async listSocialAccounts(
    token: GithubAccessToken,
  ): Promise<{ accounts: GithubSocialAccount[]; rateLimit: GithubRateLimit }> {
    const res = await this.send('user/social_accounts?per_page=100', {
      method: 'GET',
      headers: { authorization: `Bearer ${token.reveal()}` },
    });
    const rateLimit = rateLimitOf(res.headers);
    if (res.status !== 200) throw mapFailure(res);
    const parsed = socialAccountsResponse.safeParse(res.body);
    if (!parsed.success) throw new GithubUnavailableError('GET social_accounts bad body');
    return { accounts: parsed.data, rateLimit };
  }

  /**
   * `DELETE /applications/{client_id}/grant` with the OAuth App's own
   * credentials (Basic auth): removes every token the user granted the app,
   * including the one Auth0 holds (docs/modules/m7/plan.md §2.5). Anything but a
   * confirmed removal, or a grant that is already gone, throws
   * GithubRevokeFailedError: a 401 here is our client credentials, not the
   * user's token.
   */
  async deleteGrant(
    clientId: string,
    clientSecret: string,
    token: GithubAccessToken,
  ): Promise<RevokeResult> {
    let res: UpstreamResponse;
    try {
      res = await this.send(`applications/${encodeURIComponent(clientId)}/grant`, {
        method: 'DELETE',
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        json: { access_token: token.reveal() },
      });
    } catch (err) {
      if (err instanceof GithubUnavailableError) {
        throw new GithubRevokeFailedError(err.logDetail ?? 'unavailable');
      }
      throw err;
    }
    if (res.status === 204) return 'revoked';
    if ((GRANT_ALREADY_GONE as readonly number[]).includes(res.status)) return 'already_gone';
    // A 5xx may have been processed: the outcome is unknown.
    if (res.status >= 500) {
      throw new GithubRevokeFailedError(`DELETE grant ${res.status}`, false, res.status);
    }
    // Any other answer says the delete did not happen. If GitHub also refuses the
    // token, there is nothing left to revoke; otherwise the grant stands.
    const probe = await this.tokenStatus(token);
    if (probe === 401) return 'token_refused';
    throw new GithubRevokeFailedError(
      `DELETE grant ${res.status}; token check ${probe ?? 'unanswered'}`,
      true,
      res.status,
    );
  }

  /** GitHub's status for `GET /user` with the token, or null when it gave no answer. */
  private async tokenStatus(token: GithubAccessToken): Promise<number | null> {
    try {
      const res = await this.send('user', {
        method: 'GET',
        headers: { authorization: `Bearer ${token.reveal()}` },
      });
      return res.status;
    } catch (err) {
      if (err instanceof GithubUnavailableError) return null;
      throw err;
    }
  }

  /**
   * `GET /user/repos`: public repositories the caller owns or collaborates on
   * (D6: no private scope is ever requested), most recently pushed first.
   */
  async listRepos(
    token: GithubAccessToken,
    { page, perPage }: { page: number; perPage: number },
  ): Promise<GithubRepoPage> {
    const query = new URLSearchParams({
      affiliation: 'owner,collaborator',
      visibility: 'public',
      sort: 'pushed',
      direction: 'desc',
      per_page: String(perPage),
      page: String(page),
    });
    const res = await this.send(`user/repos?${query.toString()}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token.reveal()}` },
    });
    if (res.status !== 200) throw mapFailure(res);
    const parsed = z.array(repoResponse).safeParse(res.body);
    if (!parsed.success) throw new GithubUnavailableError('GET /user/repos bad body');
    return {
      items: parsed.data.map(toRepo),
      nextPage: nextPageOf(res.headers.get('link')),
      rateLimit: rateLimitOf(res.headers),
    };
  }

  /**
   * `GET /repos/{owner}/{repo}/languages`: the languages of one public
   * repository (names only; the byte counts are not used). Owner and name come
   * from a validated `GithubRepo`, never from a caller. `null`: gone or not
   * visible to the token.
   */
  async listLanguages(
    token: GithubAccessToken,
    repo: Pick<GithubRepo, 'ownerLogin' | 'name'>,
  ): Promise<{ languages: string[] | null; rateLimit: GithubRateLimit }> {
    if (!NAME.test(repo.ownerLogin) || !NAME.test(repo.name)) {
      throw new Error('repository owner and name must be plain names');
    }
    const res = await this.send(`repos/${repo.ownerLogin}/${repo.name}/languages`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token.reveal()}` },
    });
    const rateLimit = rateLimitOf(res.headers);
    if (res.status === 404) return { languages: null, rateLimit };
    if (res.status !== 200) throw mapFailure(res);
    const parsed = languagesResponse.safeParse(res.body);
    if (!parsed.success) throw new GithubUnavailableError('GET languages bad body');
    return { languages: Object.keys(parsed.data), rateLimit };
  }

  /**
   * `GET /repositories/{id}`: by GitHub's integer id, so no name or URL from
   * a caller reaches the path. `null`: gone, or not visible to the token.
   */
  async getRepo(
    token: GithubAccessToken,
    repoId: number,
  ): Promise<{ repo: GithubRepo | null; rateLimit: GithubRateLimit }> {
    const res = await this.send(`repositories/${repoPathId(repoId)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token.reveal()}` },
    });
    const rateLimit = rateLimitOf(res.headers);
    if (res.status === 404 || res.status === 403 || res.status === 451) {
      // 403 without an exhausted limit is a repository the token may not read;
      // an exhausted one maps to the rate-limit error first.
      if (res.status === 404) return { repo: null, rateLimit };
      const failure = mapFailure(res);
      if (failure instanceof GithubRateLimitedError) throw failure;
      return { repo: null, rateLimit };
    }
    if (res.status !== 200) throw mapFailure(res);
    const parsed = repoResponse.safeParse(res.body);
    if (!parsed.success) throw new GithubUnavailableError('GET /repositories/{id} bad body');
    return { repo: toRepo(parsed.data), rateLimit };
  }

  /**
   * `GET /repositories/{id}/readme` as GitHub-rendered HTML. `readme` is
   * `null` when the repository has none and `'too_large'` over `maxBytes` (the
   * body is never read past it; the headers of that answer still give the limit).
   */
  async getReadme(
    token: GithubAccessToken,
    repoId: number,
    maxBytes: number,
  ): Promise<{ readme: GithubReadme | null | 'too_large'; rateLimit: GithubRateLimit | null }> {
    let res: UpstreamResponse;
    try {
      res = await this.send(
        `repositories/${repoPathId(repoId)}/readme`,
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${token.reveal()}`,
            accept: 'application/vnd.github.html+json',
          },
          asText: true,
        },
        maxBytes,
      );
    } catch (err) {
      if (err instanceof GithubBodyTooLargeError) {
        // The answer arrived; only its body was refused: its headers still count.
        return { readme: 'too_large', rateLimit: rateLimitOf(err.upstreamHeaders) };
      }
      throw err;
    }
    const rateLimit = rateLimitOf(res.headers);
    if (res.status === 404) return { readme: null, rateLimit };
    if (res.status !== 200 || res.text === undefined) throw mapFailure(res);
    const path = /^\s*<div[^>]*\sdata-path="([^"]{1,255})"/.exec(res.text)?.[1] ?? 'README.md';
    return {
      readme: { html: res.text, path: /^[A-Za-z0-9_./ -]+$/.test(path) ? path : 'README.md' },
      rateLimit,
    };
  }

  private async send(
    path: string,
    req: Pick<UpstreamRequest, 'method' | 'headers' | 'json' | 'asText'>,
    maxBytes: number = MAX_BODY_BYTES,
  ): Promise<UpstreamResponse> {
    try {
      return await upstreamRequest(new URL(path, this.settings.baseUrl), {
        ...req,
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': GITHUB_API_VERSION,
          // GitHub refuses requests without a User-Agent.
          'user-agent': 'gradfolio-api',
          ...req.headers,
        },
        signal: AbortSignal.timeout(this.settings.timeoutMs),
        maxBytes,
      });
    } catch (err) {
      if (err instanceof UpstreamFailure) {
        const detail = `${req.method} ${err.kind}: ${err.source}`;
        if (err.kind === 'too_large' && err.headers !== undefined) {
          throw new GithubBodyTooLargeError(detail, err.headers);
        }
        throw new GithubUnavailableError(detail);
      }
      throw err;
    }
  }
}

/** A repository id as a path segment: a positive safe integer, nothing else. */
function repoPathId(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error('repository id must be a positive integer');
  return String(id);
}

function toRepo(r: z.infer<typeof repoResponse>): GithubRepo {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    description: r.description,
    language: r.language,
    topics: r.topics,
    stars: r.stargazers_count,
    forks: r.forks_count,
    htmlUrl: r.html_url,
    private: r.private,
    fork: r.fork,
    archived: r.archived,
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at,
    ownerId: r.owner.id,
    ownerLogin: r.owner.login,
    canPush: r.permissions?.push === true || r.permissions?.admin === true,
  };
}

/** The page after this one, from `Link: <…?page=3>; rel="next"`. */
export function nextPageOf(link: string | null): number | null {
  if (link === null) return null;
  for (const part of link.split(',')) {
    if (!/;\s*rel="next"/.test(part)) continue;
    const url = /<([^>]+)>/.exec(part)?.[1];
    const page = url === undefined ? null : URL.parse(url)?.searchParams.get('page');
    const n = Number(page);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return null;
}

export function rateLimitOf(headers: Headers): GithubRateLimit {
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = Number(headers.get('x-ratelimit-reset'));
  return {
    remaining: remaining !== null && /^\d+$/.test(remaining) ? Number(remaining) : null,
    resetsAt:
      Number.isFinite(reset) && reset > 0 ? new Date(Math.floor(reset) * 1000).toISOString() : null,
  };
}

/** The error for a response that is not the success the caller expected. */
export function mapFailure(res: UpstreamResponse, nowMs: number = Date.now()): Error {
  if (res.status === 401) return new GithubNotLinkedError('github 401', 401);
  if (res.status === 403 || res.status === 429) {
    const exhausted = res.headers.get('x-ratelimit-remaining') === '0';
    if (exhausted || res.headers.has('retry-after')) {
      return new GithubRateLimitedError(
        retryAfterSeconds(res.headers, 'x-ratelimit-reset', nowMs) ?? 60,
      );
    }
  }
  return new GithubUnavailableError(`github ${res.status}`, res.status);
}
