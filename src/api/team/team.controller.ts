import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import {
  type AddExternalMember,
  addExternalMemberSchema,
  type InviteMember,
  inviteMemberSchema,
  type TeamList,
  type TeamMember,
} from './dto/team.dto.js';
import { TeamWriteService } from './services/team-write.service.js';
import { TeamService } from './services/team.service.js';

@Controller('projects/:id/team')
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly writes: TeamWriteService,
  ) {}

  /** Every membership of the caller's project, in every status. 404 for anyone else. */
  @Get()
  list(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<TeamList> {
    return this.team.listForOwner(user.id, id);
  }

  /** Owner invites a user with a public profile. The invitee is notified in the same transaction. */
  @Post()
  invite(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Body(zodBody(inviteMemberSchema)) body: InviteMember,
  ): Promise<TeamMember> {
    return this.writes.invite(user, id, body);
  }

  /** Owner adds a named teammate without an account. */
  @Post('external')
  addExternal(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Body(zodBody(addExternalMemberSchema)) body: AddExternalMember,
  ): Promise<TeamMember> {
    return this.writes.addExternal(user.id, id, body);
  }

  // `me/...` routes come before `:memberId`, or `me` would be taken for an id.

  /** The invitee accepts. */
  @Post('me/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<TeamMember> {
    return this.writes.accept(user, id);
  }

  /** The invitee declines. */
  @Post('me/reject')
  @HttpCode(200)
  reject(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<TeamMember> {
    return this.writes.reject(user, id);
  }

  /** An accepted teammate leaves. */
  @Delete('me')
  @HttpCode(204)
  async leave(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<void> {
    await this.writes.leave(user, id);
  }

  /** Owner removes a membership. */
  @Delete(':memberId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ): Promise<void> {
    await this.writes.remove(user.id, id, memberId);
  }
}
