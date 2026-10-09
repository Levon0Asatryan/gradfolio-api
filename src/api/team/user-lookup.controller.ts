import { Controller, Get, Query } from '@nestjs/common';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import { lookupQuerySchema } from './dto/team.dto.js';
import { UserLookupService } from './services/user-lookup.service.js';

/**
 * Registered before `ProfilesController` (see `ApiModule`): `GET /users/:id`
 * would otherwise take `lookup` for an id.
 */
@Controller('users/lookup')
export class UserLookupController {
  constructor(private readonly lookup: UserLookupService) {}

  @RateBudget('lookup')
  @Get()
  find(@CurrentUser() user: UserRow, @Query(zodQuery(lookupQuerySchema)) query: { q: string }) {
    return this.lookup.lookup(user.id, query.q);
  }
}
