import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import type { TeamList } from './dto/team.dto.js';
import { TeamService } from './services/team.service.js';

@Controller('projects/:id/team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  /** Every membership of the caller's project, in every status. 404 for anyone else. */
  @Get()
  list(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<TeamList> {
    return this.team.listForOwner(user.id, id);
  }
}
