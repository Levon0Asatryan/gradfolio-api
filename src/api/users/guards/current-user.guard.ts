import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_OPTIONAL_AUTH, IS_PUBLIC } from '../../auth/auth.constants.js';
import type { UserRow } from '../repositories/user.repository.js';
import { UsersService } from '../services/users.service.js';
import type { AuthenticatedRequest } from '../../auth/auth.constants.js';

export interface UserRequest extends AuthenticatedRequest {
  user?: UserRow;
}

/**
 * Global guard, last in line: after the token is verified and the rate limit
 * has passed, resolves (or, on first login, creates) the caller's row and sets
 * `req.user`. After the rate limit, so a flood from one user never reaches
 * MySQL. Public routes skip it.
 */
@Injectable()
export class CurrentUserGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<UserRequest>();
    const isOptional = this.reflector.getAllAndOverride<boolean | undefined>(IS_OPTIONAL_AUTH, [
      context.getHandler(),
      context.getClass(),
    ]);
    // An anonymous caller on an @OptionalAuth route has no row to resolve.
    if (isOptional && req.auth === undefined) return true;
    // The access-token guard ran first and refuses a request without one.
    if (req.auth === undefined) throw new Error('CurrentUserGuard ran before AccessTokenGuard');
    req.user = await this.users.resolve(req.auth);
    return true;
  }
}
