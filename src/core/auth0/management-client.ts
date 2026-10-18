import { z } from 'zod';
import { Secret } from '../upstream/secret.js';
import {
  retryAfterSeconds,
  upstreamRequest,
  UpstreamFailure,
  type UpstreamResponse,
} from '../upstream/request.js';
import { IntegrationUnavailableError } from './errors.js';
import { abortable, SpacedQueue } from './spaced-queue.js';

/**
 * Auth0's Management API, as the machine-to-machine application (docs/m7-plan.md
 * §2.2): read a user's linked identities (with their IdP tokens) and link a
 * second identity to a user. Nothing else.
 *
 * - The M2M token comes from `POST {issuer}oauth/token` and is kept in memory
 *   until 60 s before it expires; concurrent callers share one fetch.
 * - Every Management API call goes through one SpacedQueue (concurrency 1,
 *   AUTH0_MANAGEMENT_SPACING_MS apart). A 429 pauses the queue until its reset
 *   and answers 503 INTEGRATION_UNAVAILABLE with Retry-After.
 * - A 401 or 403 means our own credentials: the cached M2M token is dropped,
 *   and the caller gets 503.
 */

export interface ManagementSettings {
  /** The tenant's issuer, `https://<tenant>/`. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
  spacingMs: number;
}

/** One of a user's linked identities, as the Management API lists it. */
export interface ManagementIdentity {
  provider: string;
  /** The provider's own user id (GitHub's numeric id), as a string. */
  userId: string;
  isSocial: boolean;
  /** The provider's access token, when `read:user_idp_tokens` returned it. */
  accessToken?: Secret;
}

/** What linking an identity did, from Auth0's answer. */
export type LinkResult =
  /** Auth0 linked it. */
  | { outcome: 'linked' }
  /** Auth0 answered and did not link it (a 4xx about the request); `detail` is its own words. */
  | { outcome: 'refused'; status: number; detail: RefusalDetail }
  /** The request was never processed: nothing was linked. */
  | { outcome: 'not_attempted'; error: IntegrationUnavailableError }
  /** Sent, but no answer that says whether it was linked (timeout, 5xx). */
  | { outcome: 'unknown'; error: IntegrationUnavailableError };

/**
 * What Auth0 said about a refusal: the `error`, `message` and `errorCode` of its
 * 4xx body, each cut and stripped of control characters. They name a rule
 * ("the user is already linked"), never a credential, and are what turns a
 * "refused" into a diagnosis.
 */
export interface RefusalDetail {
  error: string | null;
  message: string | null;
  errorCode: string | null;
}

/** What deleting a user did. */
export type DeleteUserResult = 'deleted' | 'already_gone';

/** What unlinking an identity did. */
export type UnlinkResult = 'unlinked' | 'already_gone';

export interface Auth0Management {
  /**
   * Deletes the user and every identity linked to it (`DELETE /users/{id}`, scope
   * `delete:users`, which the M2M application does not have until the owner grants it).
   */
  deleteUser(sub: string, signal?: AbortSignal): Promise<DeleteUserResult>;
  /** The user's identities; null when Auth0 has no such user. */
  identities(sub: string, signal?: AbortSignal): Promise<ManagementIdentity[] | null>;
  /** Links the secondary account the id token names to `primarySub`. */
  linkIdentity(primarySub: string, idToken: string, signal?: AbortSignal): Promise<LinkResult>;
  /**
   * Unlinks a secondary identity from `primarySub` (`DELETE /users/{id}/identities/{provider}/{user_id}`,
   * scope `update:users`). Auth0 re-creates the former secondary as a standalone user. A user or
   * an identity that is not there is `already_gone`.
   */
  unlinkIdentity(
    primarySub: string,
    provider: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<UnlinkResult>;
}

const MAX_BODY_BYTES = 256 * 1024;
/** Renew the M2M token this long before it expires. */
const TOKEN_MARGIN_S = 60;

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

const identitiesResponse = z.object({
  identities: z
    .array(
      z.object({
        provider: z.string(),
        user_id: z.union([z.string(), z.number().int()]).transform(String),
        isSocial: z.boolean().optional(),
        access_token: z.string().min(1).optional(),
      }),
    )
    .default([]),
});

export class Auth0ManagementClient implements Auth0Management {
  private readonly queue: SpacedQueue;
  private cached: { token: Secret; renewAt: number } | undefined;
  private inFlight: Promise<Secret> | undefined;

  constructor(
    private readonly settings: ManagementSettings,
    private readonly now: () => number = Date.now,
  ) {
    this.queue = new SpacedQueue(settings.spacingMs, now);
  }

  async identities(sub: string, signal?: AbortSignal): Promise<ManagementIdentity[] | null> {
    const url = this.apiUrl(`users/${encodeURIComponent(sub)}`);
    url.searchParams.set('fields', 'identities');
    url.searchParams.set('include_fields', 'true');
    let res: UpstreamResponse;
    try {
      res = await this.call(url, 'GET', undefined, signal);
    } catch (err) {
      throw this.unavailable(err);
    }
    if (res.status === 404) return null;
    this.refuseOwnCredentialProblems(res);
    if (res.status !== 200) throw new IntegrationUnavailableError(`management api ${res.status}`);
    const parsed = identitiesResponse.safeParse(res.body);
    if (!parsed.success) throw new IntegrationUnavailableError('management api bad body');
    return parsed.data.identities.map((i) => ({
      provider: i.provider,
      userId: i.user_id,
      isSocial: i.isSocial ?? false,
      ...(i.access_token === undefined ? {} : { accessToken: new Secret(i.access_token) }),
    }));
  }

  async linkIdentity(
    primarySub: string,
    idToken: string,
    signal?: AbortSignal,
  ): Promise<LinkResult> {
    const url = this.apiUrl(`users/${encodeURIComponent(primarySub)}/identities`);
    let res: UpstreamResponse;
    try {
      res = await this.call(url, 'POST', { link_with: idToken }, signal);
    } catch (err) {
      // Before the request was sent (the token, the queue) nothing was linked;
      // once sent, a timeout or a dropped connection says nothing either way.
      if (err instanceof NotSent) return { outcome: 'not_attempted', error: this.unavailable(err) };
      return { outcome: 'unknown', error: this.unavailable(err) };
    }
    if (res.status >= 200 && res.status < 300) return { outcome: 'linked' };
    try {
      this.refuseOwnCredentialProblems(res);
    } catch (err) {
      return { outcome: 'not_attempted', error: err as IntegrationUnavailableError };
    }
    if (res.status >= 400 && res.status < 500) {
      return { outcome: 'refused', status: res.status, detail: refusalDetail(res.body) };
    }
    return {
      outcome: 'unknown',
      error: new IntegrationUnavailableError(`management api ${res.status}`),
    };
  }

  async deleteUser(sub: string, signal?: AbortSignal): Promise<DeleteUserResult> {
    const url = this.apiUrl(`users/${encodeURIComponent(sub)}`);
    let res: UpstreamResponse;
    try {
      res = await this.call(url, 'DELETE', undefined, signal);
    } catch (err) {
      throw this.unavailable(err);
    }
    if (res.status >= 200 && res.status < 300) return 'deleted';
    if (res.status === 404) return 'already_gone';
    this.refuseOwnCredentialProblems(res);
    throw new IntegrationUnavailableError(`management api ${res.status}`);
  }

  async unlinkIdentity(
    primarySub: string,
    provider: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<UnlinkResult> {
    const url = this.apiUrl(
      `users/${encodeURIComponent(primarySub)}/identities/${encodeURIComponent(provider)}/${encodeURIComponent(userId)}`,
    );
    let res: UpstreamResponse;
    try {
      res = await this.call(url, 'DELETE', undefined, signal);
    } catch (err) {
      throw this.unavailable(err);
    }
    if (res.status >= 200 && res.status < 300) return 'unlinked';
    if (res.status === 404) return 'already_gone';
    this.refuseOwnCredentialProblems(res);
    throw new IntegrationUnavailableError(`management api ${res.status}`);
  }

  private apiUrl(path: string): URL {
    return new URL(`api/v2/${path}`, this.settings.issuer);
  }

  /** A Management API call: the M2M token, then the queue, then the request, all within one deadline. */
  private async call(
    url: URL,
    method: 'GET' | 'POST' | 'DELETE',
    json: unknown,
    outer: AbortSignal | undefined,
  ): Promise<UpstreamResponse> {
    const timeout = AbortSignal.timeout(this.settings.timeoutMs);
    const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;
    let token: Secret;
    try {
      token = await this.m2mToken(signal);
    } catch (err) {
      throw new NotSent(err);
    }
    let started = false;
    try {
      return await this.queue.run(() => {
        started = true;
        return upstreamRequest(url, {
          method,
          headers: { authorization: `Bearer ${token.reveal()}`, accept: 'application/json' },
          json,
          signal,
          maxBytes: MAX_BODY_BYTES,
        });
      }, signal);
    } catch (err) {
      if (!started) throw new NotSent(err);
      throw err;
    }
  }

  /** 401/403: our credentials; 429: the tenant's rate limit. Both are 503 to the caller. */
  private refuseOwnCredentialProblems(res: UpstreamResponse): void {
    if (res.status === 401 || res.status === 403) {
      this.cached = undefined;
      throw new IntegrationUnavailableError(`management api ${res.status}`);
    }
    if (res.status === 429) {
      const wait = retryAfterSeconds(res.headers, 'x-ratelimit-reset', this.now()) ?? 1;
      this.queue.pauseUntil(this.now() + wait * 1000);
      throw new IntegrationUnavailableError('management api 429', wait);
    }
  }

  private async m2mToken(signal: AbortSignal): Promise<Secret> {
    if (this.cached && this.now() < this.cached.renewAt) return this.cached.token;
    if (signal.aborted) throw signal.reason as Error;
    // One fetch for every concurrent caller; each still waits only as long as
    // its own deadline allows. A fetch every waiter gave up on still settles:
    // its failure is observed here, never left as an unhandled rejection.
    if (this.inFlight === undefined) {
      const fetching = this.fetchM2mToken().finally(() => {
        this.inFlight = undefined;
      });
      fetching.catch(() => undefined);
      this.inFlight = fetching;
    }
    return abortable(this.inFlight, signal);
  }

  private async fetchM2mToken(): Promise<Secret> {
    const { issuer, clientId, clientSecret, timeoutMs } = this.settings;
    const res = await upstreamRequest(new URL('oauth/token', issuer), {
      method: 'POST',
      headers: { accept: 'application/json' },
      json: {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: new URL('api/v2/', issuer).toString(),
      },
      signal: AbortSignal.timeout(timeoutMs),
      maxBytes: MAX_BODY_BYTES,
    });
    if (res.status !== 200) throw new IntegrationUnavailableError(`m2m token ${res.status}`);
    const parsed = tokenResponse.safeParse(res.body);
    if (!parsed.success) throw new IntegrationUnavailableError('m2m token bad body');
    const token = new Secret(parsed.data.access_token);
    const lifetimeMs = Math.max(0, parsed.data.expires_in - TOKEN_MARGIN_S) * 1000;
    this.cached = { token, renewAt: this.now() + lifetimeMs };
    return token;
  }

  private unavailable(err: unknown): IntegrationUnavailableError {
    const cause = err instanceof NotSent ? err.inner : err;
    if (cause instanceof IntegrationUnavailableError) return cause;
    if (cause instanceof UpstreamFailure) {
      return new IntegrationUnavailableError(`management api ${cause.kind}: ${cause.source}`);
    }
    if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
      return new IntegrationUnavailableError(`management api ${cause.name}`);
    }
    throw cause;
  }
}

/** Failed before the request left: the M2M token, or the wait for the queue. */
class NotSent extends Error {
  constructor(readonly inner: unknown) {
    super('not sent');
  }
}

/** A short, single-line, printable version of a text Auth0 sent. */
const clean = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== ''
    ? v
        .replace(/\p{Cc}+/gu, ' ')
        .trim()
        .slice(0, 200)
    : null;

/** `error`, `message` and `errorCode` of an Auth0 error body; nothing else is read. */
export function refusalDetail(body: unknown): RefusalDetail {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return { error: clean(b.error), message: clean(b.message), errorCode: clean(b.errorCode) };
}
