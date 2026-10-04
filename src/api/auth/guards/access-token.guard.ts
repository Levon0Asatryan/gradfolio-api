import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AccessTokenVerifier, bearerToken } from '../../../core/auth/access-token.js';
import { UnauthenticatedError } from '../../../core/auth/errors.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AuthenticatedRequest,
  IS_OPTIONAL_AUTH,
  IS_PUBLIC,
} from '../auth.constants.js';

/**
 * Global guard, first in line: every route needs a valid Auth0 access token
 * unless it is marked @Public(). Sets `req.auth` for the guards and handlers
 * after it. Refusals are 401 UNAUTHENTICATED; a key-source outage is 503
 * AUTH_UNAVAILABLE (core/auth/access-token.ts).
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const isOptional = this.reflector.getAllAndOverride<boolean | undefined>(IS_OPTIONAL_AUTH, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Anonymous only when no Authorization header was sent at all (@OptionalAuth).
    if (isOptional && req.headers.authorization === undefined) return true;

    const token = bearerToken(req.headers.authorization);
    if (token === undefined) throw new UnauthenticatedError('missing');

    req.auth = await this.verifier.verify(token);
    return true;
  }
}
