import { Controller, Get, Query } from '@nestjs/common';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator.js';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import {
  type Suggestions,
  type SuggestionsQuery,
  suggestionsQuerySchema,
} from './dto/discovery.dto.js';
import { SuggestService } from './services/suggest.service.js';

/** Typeahead for the search box: public, viewer-independent, a few of each kind. */
@OptionalAuth()
@RateBudget('suggest')
@Controller('search/suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestService) {}

  @Get()
  suggest(@Query(zodQuery(suggestionsQuerySchema)) query: SuggestionsQuery): Promise<Suggestions> {
    return this.suggestions.suggest(query);
  }
}
