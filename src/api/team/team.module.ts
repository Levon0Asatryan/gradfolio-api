import { Module } from '@nestjs/common';
import { TeamService } from './services/team.service.js';
import { TeamController } from './team.controller.js';

@Module({ controllers: [TeamController], providers: [TeamService] })
export class TeamModule {}
