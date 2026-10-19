import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { EducationSuggestionsService } from './services/education-suggestions.service.js';
import { ProjectSuggestionsService } from './services/project-suggestions.service.js';
import { SuggestionsService } from './services/suggestions.service.js';
import { SuggestionsController } from './suggestions.controller.js';

@Module({
  imports: [IntegrationsModule, ProfilesModule],
  controllers: [SuggestionsController],
  providers: [SuggestionsService, ProjectSuggestionsService, EducationSuggestionsService],
})
export class SuggestionsModule {}
