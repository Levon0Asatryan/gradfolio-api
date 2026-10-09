import { Module } from '@nestjs/common';
import { MyProjectsController } from './my-projects.controller.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectService } from './services/project.service.js';
import { ProjectWriteService } from './services/project-write.service.js';
import { UserProjectsController } from './user-projects.controller.js';

@Module({
  controllers: [ProjectsController, MyProjectsController, UserProjectsController],
  providers: [ProjectService, ProjectWriteService],
})
export class ProjectsModule {}
