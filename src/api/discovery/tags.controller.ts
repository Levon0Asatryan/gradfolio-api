import { Controller, Get, Query } from '@nestjs/common';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator.js';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import {
  type DiscoveryProjectPage,
  type PersonPage,
  type TagCloud,
  type TagCloudQuery,
  tagCloudQuerySchema,
  type TagPageQuery,
  type TagQuery,
  type TagSummary,
  tagPageQuerySchema,
  tagQuerySchema,
} from './dto/discovery.dto.js';
import { BrowseService } from './services/browse.service.js';
import { TagService } from './services/tag.service.js';

/** Tag pages: projects and people for a skill, technology or tag (docs/m6-plan.md §3). */
@OptionalAuth()
@RateBudget('browse')
@Controller('tags')
export class TagsController {
  constructor(
    private readonly tags: TagService,
    private readonly browse: BrowseService,
  ) {}

  @Get('cloud')
  cloud(@Query(zodQuery(tagCloudQuerySchema)) query: TagCloudQuery): Promise<TagCloud> {
    return this.browse.tagCloud(query);
  }

  @Get()
  summary(@Query(zodQuery(tagQuerySchema)) query: TagQuery): Promise<TagSummary> {
    return this.tags.summary(query);
  }

  @Get('projects')
  projects(
    @Query(zodQuery(tagPageQuerySchema)) query: TagPageQuery,
  ): Promise<DiscoveryProjectPage> {
    return this.tags.projects(query);
  }

  @Get('people')
  people(@Query(zodQuery(tagPageQuerySchema)) query: TagPageQuery): Promise<PersonPage> {
    return this.tags.people(query);
  }
}
