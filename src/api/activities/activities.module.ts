import { Module } from '@nestjs/common';
import { ActivitiesController } from './activities.controller.js';
import { ActivityService } from './services/activity.service.js';

@Module({ controllers: [ActivitiesController], providers: [ActivityService] })
export class ActivitiesModule {}
