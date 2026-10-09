import { Controller, Get, Query } from '@nestjs/common';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import { type ActivityPage, type ActivityQuery, activityQuerySchema } from './dto/activity.dto.js';
import { ActivityService } from './services/activity.service.js';

/** The caller's own activity feed (the dashboard). */
@Controller('me/activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivityService) {}

  @Get()
  list(
    @CurrentUser() user: UserRow,
    @Query(zodQuery(activityQuerySchema)) query: ActivityQuery,
  ): Promise<ActivityPage> {
    return this.activities.list(user.id, query);
  }
}
