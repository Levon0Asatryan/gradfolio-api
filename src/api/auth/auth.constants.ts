import type { Request } from 'express';
import type { AccessTokenIdentity } from '../../core/auth/access-token.js';

/** Injection token for the AccessTokenVerifier (one per process: it owns the JWKS cache). */
export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

/** Route metadata set by @Public(). */
export const IS_PUBLIC = 'gradfolio:isPublic';

/** Route metadata set by @OptionalAuth(). */
export const IS_OPTIONAL_AUTH = 'gradfolio:isOptionalAuth';

/** A request after the access-token guard: `auth` is set on every non-public route. */
export interface AuthenticatedRequest extends Request {
  auth?: AccessTokenIdentity;
}
