import { errors, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import {
  guardedKeySet,
  KeySourceUnavailable,
  type KeySetTiming,
  rejectionReason,
} from './access-token.js';
import { AuthUnavailableError, InvalidIdTokenError } from './errors.js';

/**
 * Verifies the id token of the secondary GitHub sign-in that `POST
 * /v1/me/integrations/github/link` forwards (docs/modules/m7/plan.md §2.3 step 1):
 * RS256 only, signature against the tenant's JWKS, the tenant's issuer, the
 * audience the `Gradfolio` application's client id, `exp` required, `iat` at
 * most LINK_ID_TOKEN_MAX_AGE_S old, `sub` a GitHub identity, and a `nonce`
 * claim (checked against the stored hash by the caller).
 */

export interface LinkIdToken {
  /** `github|<id>`. */
  sub: string;
  /** GitHub's numeric user id: the part of `sub` after `github|`. */
  githubUserId: string;
  /** The raw nonce the frontend passed to `/authorize`; only its hash is stored. */
  nonce: string;
}

export interface IdTokenVerifier {
  /** Throws InvalidIdTokenError (400) or AuthUnavailableError (503). */
  verify(idToken: string): Promise<LinkIdToken>;
}

export interface IdTokenSettings {
  issuer: string;
  /** The `Gradfolio` application's client id: the id token's audience. */
  clientId: string;
  jwksTimeoutMs: number;
  clockToleranceS: number;
  maxAgeS: number;
}

/** GitHub user ids are positive integers. */
const GITHUB_SUB = /^github\|([1-9][0-9]{0,19})$/;
/** Our nonces are 43 base64url characters; anything far longer is not ours. */
const nonceClaim = z.string().min(1).max(200);

export function createIdTokenVerifier(
  settings: IdTokenSettings,
  timing: KeySetTiming = {},
): IdTokenVerifier {
  const getKey = guardedKeySet(
    { AUTH0_ISSUER_BASE_URL: settings.issuer, AUTH0_JWKS_TIMEOUT_MS: settings.jwksTimeoutMs },
    timing,
  );
  const options = {
    issuer: settings.issuer,
    audience: settings.clientId,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
    // jose refuses an `iat` older than this (JWTExpired) or in the future (run).
    maxTokenAge: settings.maxAgeS,
    clockTolerance: settings.clockToleranceS,
  };

  return {
    async verify(idToken) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(idToken, getKey, options));
      } catch (err) {
        if (err instanceof KeySourceUnavailable) throw new AuthUnavailableError(err.source);
        if (err instanceof errors.JOSEError) throw new InvalidIdTokenError(rejectionReason(err));
        throw err;
      }
      const sub = typeof payload.sub === 'string' ? GITHUB_SUB.exec(payload.sub) : null;
      if (sub === null) throw new InvalidIdTokenError('not-github');
      const nonce = nonceClaim.safeParse(payload.nonce);
      if (!nonce.success) throw new InvalidIdTokenError('nonce');
      return { sub: sub[0], githubUserId: sub[1]!, nonce: nonce.data };
    },
  };
}
