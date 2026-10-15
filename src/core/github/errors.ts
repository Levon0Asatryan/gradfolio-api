import { AppError } from '../errors/app-error.js';

/**
 * How GitHub's answers reach our caller (docs/m7-plan.md §3.1). Each carries a
 * fixed message; GitHub's status goes to the log, its body never does.
 */

/** 409: GitHub refused the token (revoked, or the identity is gone at Auth0). */
export class GithubNotLinkedError extends AppError {
  constructor(cause: string) {
    super(
      'GITHUB_NOT_LINKED',
      'the GitHub account is no longer linked; sign in with GitHub again, then connect',
      409,
    );
    this.logDetail = `github not linked: ${cause}`;
  }
}

/** 429: GitHub's rate limit for this user; Retry-After from GitHub's own headers. */
export class GithubRateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('GITHUB_RATE_LIMITED', 'GitHub is limiting requests; try again later', 429);
    this.headers = { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) };
  }
}

/** 502: GitHub failed, timed out, or answered something we do not expect. */
export class GithubUnavailableError extends AppError {
  constructor(cause: string) {
    super('GITHUB_UNAVAILABLE', 'GitHub could not be reached', 502);
    this.logDetail = `github unavailable: ${cause}`;
  }
}

/** 502: GitHub did not confirm the revocation (D9); `refused` says whether nothing changed. */
export class GithubRevokeFailedError extends AppError {
  /**
   * `true`: GitHub answered that the grant was **not** deleted (a 4xx), or the
   * request never left. `false`: a timeout, a dropped connection or a 5xx, after
   * which GitHub may still delete it: the outcome is unknown.
   */
  readonly refused: boolean;

  constructor(cause: string, refused = false) {
    super(
      'GITHUB_REVOKE_FAILED',
      refused
        ? 'GitHub did not confirm the revocation; nothing was changed, try again'
        : 'GitHub did not confirm the revocation and may still be processing it; ' +
            'the connection shows as disconnected until it settles, try again in a minute',
      502,
    );
    this.refused = refused;
    this.logDetail = `github revoke failed: ${cause}`;
  }
}
