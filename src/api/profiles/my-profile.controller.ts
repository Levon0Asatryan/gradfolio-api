import { Body, Controller, Get, Patch } from '@nestjs/common';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import { type ProfileHeader, type UpdateProfile, updateProfileSchema } from './dto/profile.dto.js';
import { ProfileService } from './services/profile.service.js';

@Controller('me/profile')
export class MyProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  get(@CurrentUser() user: UserRow): Promise<ProfileHeader> {
    return this.profiles.getHeader(user.id);
  }

  @Patch()
  update(
    @CurrentUser() user: UserRow,
    @Body(zodBody(updateProfileSchema)) patch: UpdateProfile,
  ): Promise<ProfileHeader> {
    return this.profiles.updateHeader(user.id, patch);
  }
}
