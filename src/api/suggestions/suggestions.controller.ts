import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { AccessTokenIdentity } from '../../core/auth/access-token.js';
import type { AuthenticatedRequest } from '../auth/auth.constants.js';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import {
  type RefreshResponse,
  type ResolveResponse,
  type SuggestionPage,
  type SuggestionQuery,
  suggestionQuerySchema,
} from './dto/suggestion.dto.js';
import { SuggestionsService } from './services/suggestions.service.js';

function tokenOf(req: AuthenticatedRequest): AccessTokenIdentity {
  if (req.auth === undefined) throw new Error('suggestions route without a verified token');
  return req.auth;
}

/**
 * The caller's suggestions (docs/modules/m7/plan.md §6.5). Every route is the caller's
 * own: another user's id is 404. Reads and answers are under the `integration`
 * budget; a refresh, which may read GitHub, under the tighter `import` one.
 */
@Controller('me/suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get()
  @RateBudget('integration')
  list(
    @CurrentUser() user: UserRow,
    @Query(zodQuery(suggestionQuerySchema)) query: SuggestionQuery,
  ): Promise<SuggestionPage> {
    return this.suggestions.list(user, query);
  }

  @Post('refresh')
  @HttpCode(200)
  @RateBudget('import')
  refresh(
    @CurrentUser() user: UserRow,
    @Req() req: AuthenticatedRequest,
  ): Promise<RefreshResponse> {
    return this.suggestions.refresh(user, tokenOf(req));
  }

  @Post(':id/accept')
  @HttpCode(200)
  @RateBudget('integration')
  accept(
    @CurrentUser() user: UserRow,
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ResolveResponse> {
    return this.suggestions.accept(user, tokenOf(req), id);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @RateBudget('integration')
  dismiss(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<ResolveResponse> {
    return this.suggestions.dismiss(user, id);
  }
}
