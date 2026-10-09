import { Module } from '@nestjs/common';
import { TeamService } from './services/team.service.js';
import { MyTeamsController } from './my-teams.controller.js';
import { MyTeamsService } from './services/my-teams.service.js';
import { TeamController } from './team.controller.js';
import { UserLookupController } from './user-lookup.controller.js';
import { TeamWriteService } from './services/team-write.service.js';
import { UserLookupService } from './services/user-lookup.service.js';

@Module({
  controllers: [UserLookupController, MyTeamsController, TeamController],
  providers: [TeamService, TeamWriteService, UserLookupService, MyTeamsService],
})
export class TeamModule {}
