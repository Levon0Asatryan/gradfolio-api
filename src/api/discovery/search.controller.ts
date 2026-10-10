import { Controller, Get, Query } from '@nestjs/common';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator.js';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import {
  type DiscoveryProjectPage,
  type PersonPage,
  type SearchPageQuery,
  type SearchQuery,
  type SearchResults,
  searchPageQuerySchema,
  searchQuerySchema,
} from './dto/discovery.dto.js';
import { SearchService } from './services/search.service.js';

/**
 * Public search (docs/m6-plan.md §3). A token, when sent, is verified and only
 * changes whose rate budget is spent; the results are the same for everyone.
 */
@OptionalAuth()
@RateBudget('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  grouped(@Query(zodQuery(searchQuerySchema)) query: SearchQuery): Promise<SearchResults> {
    return this.search.grouped(query);
  }

  @Get('people')
  people(@Query(zodQuery(searchPageQuerySchema)) query: SearchPageQuery): Promise<PersonPage> {
    return this.search.people(query);
  }

  @Get('projects')
  projects(
    @Query(zodQuery(searchPageQuerySchema)) query: SearchPageQuery,
  ): Promise<DiscoveryProjectPage> {
    return this.search.projects(query);
  }
}
