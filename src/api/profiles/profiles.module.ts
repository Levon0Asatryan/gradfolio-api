import { Module } from '@nestjs/common';
import { CertificationController } from './certification.controller.js';
import { EducationController } from './education.controller.js';
import { ExperienceController } from './experience.controller.js';
import { MyProfileController } from './my-profile.controller.js';
import { ProfilesController } from './profiles.controller.js';
import { ProfileService } from './services/profile.service.js';
import { SectionService } from './services/section.service.js';
import { SkillsService } from './services/skills.service.js';
import { SkillsController } from './skills.controller.js';

@Module({
  controllers: [
    ProfilesController,
    MyProfileController,
    EducationController,
    ExperienceController,
    CertificationController,
    SkillsController,
  ],
  providers: [ProfileService, SectionService, SkillsService],
})
export class ProfilesModule {}
