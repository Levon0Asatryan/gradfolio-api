import { Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.constants.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import type { MeResponse } from './dto/me.dto.js';
import { AccountService } from './services/account.service.js';
import { OnboardingService } from './services/onboarding.service.js';

@Controller('me')
export class MeController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly account: AccountService,
  ) {}

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
      onboarded: user.onboardedAt !== null,
      identities,
    };
  }

  /** The user finished or skipped first-login onboarding. Idempotent. */
  @Post('onboarding/complete')
  @HttpCode(200)
  async completeOnboarding(@CurrentUser() user: UserRow): Promise<{ onboarded: true }> {
    await this.onboarding.complete(user.id);
    return { onboarded: true };
  }

  /** Deletes the caller's account and all its data. The frontend then signs out. */
  @Delete()
  @HttpCode(204)
  async deleteAccount(@CurrentUser() user: UserRow): Promise<void> {
    await this.account.delete(user.id);
  }
}
