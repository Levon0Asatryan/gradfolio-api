import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { AppConfig } from '../config/schema.js';
import { AuthUnavailableError, type RejectionReason, UnauthenticatedError } from './errors.js';

/**
 * Where our post-login Action puts profile claims (docs/auth0-setup.md §6).
 * Auth0 requires custom claims on an access token for a custom API to be
 * namespaced.
 */
export const CLAIM_NAMESPACE = 'https://gradfolio.app/';

/** What a verified token tells the api about its caller. */
export interface AccessTokenIdentity {
  /** `<provider>|<id>`; maps to `users.auth0_id`. */
  sub: string;
  email?: string;
  /** Absent claim = not verified. */
  emailVerified: boolean;
  name?: string;
  picture?: string;
  headline?: string;
  /** Providers of the linked identities (`google-oauth2`, `github`, ...). */
  identities: string[];
}

export interface AccessTokenVerifier {
  /** Throws UnauthenticatedError (401) or AuthUnavailableError (503). */
  verify(token: string): Promise<AccessTokenIdentity>;
}

export type VerifierConfig = Pick<
  AppConfig,
  'AUTH0_ISSUER_BASE_URL' | 'AUTH0_AUDIENCE' | 'AUTH0_JWKS_TIMEOUT_MS' | 'AUTH0_CLOCK_TOLERANCE_S'
>;

/** jose's cache settings; the defaults (10 min, 30 s) except in tests. */
export interface KeySetTiming {
  cacheMaxAge?: number;
  cooldownDuration?: number;
}

/**
 * The key source could not be consulted. Raised only from inside key
 * resolution, so it can never be confused with a verdict on the token.
 */
class KeySourceUnavailable extends Error {
  constructor(readonly source: string) {
    super('key source unavailable');
  }
}

/** Class name and code of whatever the key fetch threw; never its message. */
function sourceOf(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? `${err.name} ${code}` : err.name;
}

/** `sub` is `users.auth0_id VARCHAR(255)`. */
const subject = z.string().min(1).max(255);

/**
 * Bounds on the profile claims, in code points. Above the columns they feed
 * (users.name 255, users.email 255, users.headline 500), so a value a
 * provider sent slightly too long still reaches the pre-fill, which cuts it to
 * the column; far beyond any real value, so nothing unbounded travels on in
 * `req.auth`. An email is at most 254 characters (RFC 5321); a URL rarely
 * exceeds 2,000.
 */
export const CLAIM_LIMITS = {
  email: 320,
  name: 1_000,
  picture: 2_048,
  headline: 2_000,
  identities: 20,
  provider: 100,
} as const;

const bounded = (max: number) =>
  z
    .string()
    .refine((v) => [...v].length <= max)
    .optional()
    .catch(undefined);

/**
 * Profile claims come from our Action (namespace stripped). One of the wrong
 * type, or over its bound, is dropped rather than trusted; it never fails the
 * request (docs/m2-plan.md §3.3).
 */
const profileSchema = z.object({
  email: bounded(CLAIM_LIMITS.email),
  email_verified: z.boolean().optional().catch(undefined),
  name: bounded(CLAIM_LIMITS.name),
  picture: bounded(CLAIM_LIMITS.picture),
  headline: bounded(CLAIM_LIMITS.headline),
  identities: z
    .array(z.string().max(CLAIM_LIMITS.provider))
    .max(CLAIM_LIMITS.identities)
    .optional()
    .catch(undefined),
});

function identityOf(payload: JWTPayload): AccessTokenIdentity {
  const sub = subject.safeParse(payload.sub);
  if (!sub.success) throw new UnauthenticatedError('claim:sub');
  const namespaced = Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => key.startsWith(CLAIM_NAMESPACE))
      .map(([key, value]) => [key.slice(CLAIM_NAMESPACE.length), value]),
  );
  const p = profileSchema.parse(namespaced);
  return {
    sub: sub.data,
    email: p.email,
    emailVerified: p.email_verified === true,
    name: p.name,
    picture: p.picture,
    headline: p.headline,
    identities: p.identities ?? [],
  };
}

/**
 * The log's reason for each class jose throws while verifying (every one is
 * produced for real in access-token.test.ts). Anything else jose throws is a
 * JOSEError too, and maps to `invalid`.
 */
export function rejectionReason(err: errors.JOSEError): RejectionReason {
  if (err instanceof errors.JWTExpired) return 'expired';
  if (err instanceof errors.JWTClaimValidationFailed) return `claim:${err.claim}`;
  if (err instanceof errors.JOSEAlgNotAllowed) return 'alg';
  if (err instanceof errors.JOSENotSupported) return 'unsupported';
  if (err instanceof errors.JWSSignatureVerificationFailed) return 'signature';
  if (err instanceof errors.JWKSNoMatchingKey || err instanceof errors.JWKSMultipleMatchingKeys) {
    return 'unknown-key';
  }
  if (err instanceof errors.JWSInvalid || err instanceof errors.JWTInvalid) return 'malformed';
  return 'invalid';
}

/**
 * Verifies Auth0 access tokens: RS256 only, signature against the tenant's
 * JWKS, fixed issuer and audience, `exp` required, `exp`/`nbf` within the
 * clock tolerance (docs/m2-plan.md §3.3).
 *
 * The key set is fetched once and cached by jose: refreshed after 10 minutes,
 * and on an unknown `kid` at most once per 30 seconds, so a flood of made-up
 * key ids costs one fetch per cooldown.
 *
 * An outage is recognised by *where* the failure happened, not by its class:
 * a refused connection or DNS failure arrives as a plain TypeError, and a 500
 * from the JWKS as jose's generic JOSEError (run). Every failure while
 * resolving the key, except "no key matches this token", is an outage (503);
 * every JOSEError outside that is a verdict on the token (401).
 */
export function createAccessTokenVerifier(
  cfg: VerifierConfig,
  timing: KeySetTiming = {},
): AccessTokenVerifier {
  const remote = createRemoteJWKSet(new URL('.well-known/jwks.json', cfg.AUTH0_ISSUER_BASE_URL), {
    timeoutDuration: cfg.AUTH0_JWKS_TIMEOUT_MS,
    ...timing,
  });

  const getKey: JWTVerifyGetKey = async (header, token) => {
    try {
      return await remote(header, token);
    } catch (err) {
      if (
        err instanceof errors.JWKSNoMatchingKey ||
        err instanceof errors.JWKSMultipleMatchingKeys
      ) {
        throw err;
      }
      throw new KeySourceUnavailable(sourceOf(err));
    }
  };

  const options = {
    issuer: cfg.AUTH0_ISSUER_BASE_URL,
    audience: cfg.AUTH0_AUDIENCE,
    algorithms: ['RS256'],
    // jose checks `exp` only when present: a token without one would never
    // expire (run). `sub` is the identity itself.
    requiredClaims: ['exp', 'sub'],
    clockTolerance: cfg.AUTH0_CLOCK_TOLERANCE_S,
  };

  return {
    async verify(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, getKey, options));
      } catch (err) {
        if (err instanceof KeySourceUnavailable) throw new AuthUnavailableError(err.source);
        if (err instanceof errors.JOSEError) throw new UnauthenticatedError(rejectionReason(err));
        throw err;
      }
      return identityOf(payload);
    },
  };
}

/**
 * The token from an `Authorization` header, or undefined when there is none
 * or it is not a bearer credential. The scheme is case-insensitive (RFC 7235).
 */
export function bearerToken(header: string | undefined): string | undefined {
  const match = header === undefined ? null : /^Bearer +([^\s]+)\s*$/i.exec(header);
  return match?.[1];
}
