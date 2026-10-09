import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator.js';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import type { UserRequest } from '../users/guards/current-user.guard.js';
import {
  type ProjectPage,
  type UserProjectsQuery,
  userProjectsQuerySchema,
} from './dto/project.dto.js';
import { ProjectService } from './services/project.service.js';

@Controller('users/:id/projects')
export class UserProjectsController {
  constructor(private readonly projects: ProjectService) {}

  /** A user's public, published projects; 404 when their profile is not visible to the caller. */
  @OptionalAuth()
  @Get()
  list(
    @Param('id') id: string,
    @Query(zodQuery(userProjectsQuerySchema)) query: UserProjectsQuery,
    @Req() req: UserRequest,
  ): Promise<ProjectPage> {
    return this.projects.listOfUser(id, req.user?.id, query);
  }
}
