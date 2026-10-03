import { AppError } from '../errors/app-error.js';

/**
 * Why a token was refused, for the log only. The response is the same for
 * every reason, so a caller learns nothing about why their token failed.
 */
export type RejectionReason =
  | 'missing'
  | 'malformed'
  | 'alg'
  | 'unsupported'
  | 'signature'
  | 'expired'
  | 'unknown-key'
  | `claim:${string}`
  | 'invalid';

/** 401 for any missing, malformed or invalid access token. */
export class UnauthenticatedError extends AppError {
  constructor(readonly reason: RejectionReason) {
    super('UNAUTHENTICATED', 'authentication required', 401);
    // RFC 6750 §3: a 401 for a bearer-protected resource names the scheme. No
    // error detail: the body is identical for every reason.
    this.headers = { 'WWW-Authenticate': 'Bearer' };
    this.logDetail = `access token rejected: ${reason}`;
  }
}

/**
 * 503: the signing keys could not be consulted, so no token can be checked.
 * An outage is not the caller's fault, so it is never a 401.
 */
export class AuthUnavailableError extends AppError {
  /** `source` names the failure class and code, never a library message. */
  constructor(readonly source: string) {
    super('AUTH_UNAVAILABLE', 'authentication is temporarily unavailable', 503);
    this.logDetail = `token signing keys unavailable: ${source}`;
  }
}
