import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRow } from '../repositories/user.repository.js';
import type { UserRequest } from '../guards/current-user.guard.js';

/** The caller's `users` row, set by CurrentUserGuard. Never re-queries. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserRow => {
    const { user } = ctx.switchToHttp().getRequest<UserRequest>();
    if (user === undefined) throw new Error('@CurrentUser() on a route without a caller');
    return user;
  },
);
