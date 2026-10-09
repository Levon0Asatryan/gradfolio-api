import { Module } from '@nestjs/common';
import { TeamService } from './services/team.service.js';
import { TeamController } from './team.controller.js';
import { UserLookupController } from './user-lookup.controller.js';
import { TeamWriteService } from './services/team-write.service.js';
import { UserLookupService } from './services/user-lookup.service.js';

@Module({
  controllers: [UserLookupController, TeamController],
  providers: [TeamService, TeamWriteService, UserLookupService],
})
export class TeamModule {}
