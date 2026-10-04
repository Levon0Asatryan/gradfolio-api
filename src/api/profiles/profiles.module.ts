import { Module } from '@nestjs/common';
import { MyProfileController } from './my-profile.controller.js';
import { ProfilesController } from './profiles.controller.js';
import { ProfileService } from './services/profile.service.js';

@Module({
  controllers: [ProfilesController, MyProfileController],
  providers: [ProfileService],
})
export class ProfilesModule {}
