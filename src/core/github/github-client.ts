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
 * GitHub's REST API (docs/m7-plan.md §3.1): the base URL from configuration,
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

/** Whether a grant delete removed the grant now, or found none to remove. */
export type RevokeResult = 'revoked' | 'already_gone';

/** The API version every request pins (GitHub's `X-GitHub-Api-Version`). */
export const GITHUB_API_VERSION = '2022-11-28';
const MAX_BODY_BYTES = 1024 * 1024;

const userResponse = z.object({
  id: z.number().int().positive(),
  // GitHub logins are at most 39 characters; the column holds 100.
  login: z.string().min(1).max(100),
});

/**
 * The status GitHub gives a grant delete for a grant that no longer exists.
 * **Unverified** against the real service (docs/m7-plan.md §2.3, §2.1 step 6):
 * GitHub's documentation lists 422. Nothing else counts as gone: a 404 could
 * as well be a client id GitHub does not know, and reading that as "revoked"
 * would report a disconnect while the token stays alive. The tenant spike
 * records the real status, and this list follows it.
 */
export const GRANT_ALREADY_GONE = [422] as const;

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
   * `DELETE /applications/{client_id}/grant` with the OAuth App's own
   * credentials (Basic auth): removes every token the user granted the app,
   * including the one Auth0 holds (docs/m7-plan.md §2.5). Anything but a
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
    throw new GithubRevokeFailedError(`DELETE grant ${res.status}`);
  }

  private async send(
    path: string,
    req: Pick<UpstreamRequest, 'method' | 'headers' | 'json'>,
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
        maxBytes: MAX_BODY_BYTES,
      });
    } catch (err) {
      if (err instanceof UpstreamFailure) {
        throw new GithubUnavailableError(`${req.method} ${err.kind}: ${err.source}`);
      }
      throw err;
    }
  }
}

/** The error for a response that is not the success the caller expected. */
export function mapFailure(res: UpstreamResponse, nowMs: number = Date.now()): Error {
  if (res.status === 401) return new GithubNotLinkedError('github 401');
  if (res.status === 403 || res.status === 429) {
    const exhausted = res.headers.get('x-ratelimit-remaining') === '0';
    if (exhausted || res.headers.has('retry-after')) {
      return new GithubRateLimitedError(
        retryAfterSeconds(res.headers, 'x-ratelimit-reset', nowMs) ?? 60,
      );
    }
  }
  return new GithubUnavailableError(`github ${res.status}`);
}
