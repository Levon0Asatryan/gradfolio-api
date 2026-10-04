import { Controller, Get, Param, Req } from '@nestjs/common';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator.js';
import type { UserRequest } from '../users/guards/current-user.guard.js';
import type { ProfileResponse } from './dto/profile.dto.js';
import { ProfileService } from './services/profile.service.js';

@Controller('users')
export class ProfilesController {
  constructor(private readonly profiles: ProfileService) {}

  /**
   * A profile by id. Readable without a token when the profile is public
   * (recruiters, spec §8d); a token, when sent, identifies the owner.
   */
  @OptionalAuth()
  @Get(':id')
  get(@Param('id') id: string, @Req() req: UserRequest): Promise<ProfileResponse> {
    return this.profiles.getProfile(id, req.user?.id);
  }
}
