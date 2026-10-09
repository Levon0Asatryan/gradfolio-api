import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRequest } from '../users/guards/current-user.guard.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import type { ProjectDetail } from './dto/project.dto.js';
import { ProjectWriteService } from './services/project-write.service.js';
import { ProjectService } from './services/project.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectService,
    private readonly writes: ProjectWriteService,
  ) {}

  /**
   * A project by id. Public, published ones are readable without a token; a
   * token, when sent, identifies the owner, who also reads their private and
   * draft ones. Anyone else gets 404, as for an unknown id.
   */
  @OptionalAuth()
  @Get(':id')
  get(@Param('id') id: string, @Req() req: UserRequest): Promise<ProjectDetail> {
    return this.projects.getProject(id, req.user?.id);
  }

  /** The body is validated in the service, against schemas built from the configured limits. */
  @Post()
  create(@CurrentUser() user: UserRow, @Body() body: unknown): Promise<ProjectDetail> {
    return this.writes.create(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProjectDetail> {
    return this.writes.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<void> {
    await this.writes.remove(user.id, id);
  }
}
