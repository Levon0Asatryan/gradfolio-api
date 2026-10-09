import { Controller, Get, Param, Req } from '@nestjs/common';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator.js';
import type { UserRequest } from '../users/guards/current-user.guard.js';
import type { ProjectDetail } from './dto/project.dto.js';
import { ProjectService } from './services/project.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectService) {}

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
}
