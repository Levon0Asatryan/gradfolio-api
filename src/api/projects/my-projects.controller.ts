import { Controller, Get, Query } from '@nestjs/common';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import {
  type MyProjectsQuery,
  myProjectsQuerySchema,
  type ProjectPage,
} from './dto/project.dto.js';
import { ProjectService } from './services/project.service.js';

@Controller('me/projects')
export class MyProjectsController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  list(
    @CurrentUser() user: UserRow,
    @Query(zodQuery(myProjectsQuerySchema)) query: MyProjectsQuery,
  ): Promise<ProjectPage> {
    return this.projects.listMine(user.id, query);
  }
}
