import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { LinkedinImportController } from './linkedin-import.controller.js';
import { LinkedinImportService } from './services/linkedin-import.service.js';

/**
 * The LinkedIn export import. Its own module, registered after ProfilesModule in
 * AppModule: importing ProfilesModule from IntegrationsModule would register the profile
 * routes before `GET /users/facets` and `/users/lookup`, and `GET /users/:id` would shadow them.
 */
@Module({
  imports: [ProfilesModule],
  controllers: [LinkedinImportController],
  providers: [LinkedinImportService],
})
export class LinkedinImportModule {}
