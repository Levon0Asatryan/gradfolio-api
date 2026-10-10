import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator.js';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import {
  type BrowseProjectsQuery,
  type BrowseUsersQuery,
  browseProjectsQuerySchema,
  browseUsersQuerySchema,
  type DiscoveryProjectPage,
  type PersonPage,
  type UserFacets,
} from './dto/discovery.dto.js';
import { BrowseService } from './services/browse.service.js';

/** `GET /v1/projects`: the project gallery. `POST /v1/projects` and `/:id` live in ProjectsModule. */
@OptionalAuth()
@RateBudget('browse')
@Controller('projects')
export class BrowseProjectsController {
  constructor(private readonly browse: BrowseService) {}

  @Get()
  list(
    @Query(zodQuery(browseProjectsQuerySchema)) query: BrowseProjectsQuery,
  ): Promise<DiscoveryProjectPage> {
    return this.browse.projects(query);
  }
}

/**
 * `GET /v1/users` and `/v1/users/facets`. Registered before ProfilesModule
 * (see ApiModule): `GET /users/:id` would otherwise take `facets` for an id.
 */
@OptionalAuth()
@RateBudget('browse')
@Controller('users')
export class BrowseUsersController {
  constructor(private readonly browse: BrowseService) {}

  @Get()
  list(@Query(zodQuery(browseUsersQuerySchema)) query: BrowseUsersQuery): Promise<PersonPage> {
    return this.browse.users(query);
  }

  @Get('facets')
  facets(@Query(zodQuery(z.strictObject({}))) _query: object): Promise<UserFacets> {
    return this.browse.userFacets();
  }
}
