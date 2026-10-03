import { Controller, Get, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.constants.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import type { MeResponse } from './dto/me.dto.js';

@Controller('me')
export class MeController {
  /** The caller's own account; the first call after a login creates it. */
  @Get()
  me(@CurrentUser() user: UserRow, @Req() req: AuthenticatedRequest): MeResponse {
    const identities =
      req.auth && req.auth.identities.length > 0
        ? req.auth.identities
        : [user.auth0Id.split('|')[0] ?? ''];
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      headline: user.headline,
      verified: user.verified,
      isPublic: user.isPublic,
      identities,
    };
  }
}
