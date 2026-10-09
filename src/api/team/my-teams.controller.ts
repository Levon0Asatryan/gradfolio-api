import { Controller, Get, Query } from '@nestjs/common';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import { type MyTeams, type MyTeamsQuery, myTeamsQuerySchema } from './dto/my-teams.dto.js';
import { MyTeamsService } from './services/my-teams.service.js';

/** The caller's teams: owned, joined, incoming and outgoing invitations. */
@Controller('me/teams')
export class MyTeamsController {
  constructor(private readonly teams: MyTeamsService) {}

  @Get()
  get(
    @CurrentUser() user: UserRow,
    @Query(zodQuery(myTeamsQuerySchema)) query: MyTeamsQuery,
  ): Promise<MyTeams> {
    return this.teams.get(user.id, query);
  }
}
