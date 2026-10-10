import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import type { Dashboard } from './dto/dashboard.dto.js';
import { DashboardService } from './services/dashboard.service.js';

/** The caller's dashboard. A token is required; there is no id in the path to point at someone else. */
@Controller('me/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentUser() user: UserRow): Promise<Dashboard> {
    return this.dashboard.get(user.id);
  }
}
