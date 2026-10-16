import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { AccessTokenIdentity } from '../../core/auth/access-token.js';
import type { AuthenticatedRequest } from '../auth/auth.constants.js';
import { zodBody, zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import {
  githubImportRequestSchema,
  githubPreviewRequestSchema,
  githubReposQuerySchema,
  githubSyncQuerySchema,
} from './dto/github-import.dto.js';
import { type DraftOverrides, GithubImportService } from './services/github-import.service.js';
import { GithubSyncService } from './services/github-sync.service.js';

function tokenOf(req: AuthenticatedRequest): AccessTokenIdentity {
  if (req.auth === undefined) throw new Error('github route without a verified token');
  return req.auth;
}

/**
 * The caller's GitHub repositories and import (docs/m7-plan.md §7 items 5–6).
 * No route takes a URL or a name: repository ids only. Listing is under the
 * `integration` budget; the import is under `import`, the tighter one.
 */
@Controller('me/github')
export class GithubImportController {
  constructor(private readonly imports: GithubImportService) {}

  @Get('repos')
  @RateBudget('integration')
  repos(
    @CurrentUser() user: UserRow,
    @Req() req: AuthenticatedRequest,
    @Query(zodQuery(githubReposQuerySchema)) query: { q?: string; cursor?: string; limit?: number },
  ) {
    return this.imports.list(user, tokenOf(req), query);
  }

  @Post('import')
  @HttpCode(200)
  @RateBudget('import')
  import(
    @CurrentUser() user: UserRow,
    @Req() req: AuthenticatedRequest,
    @Body(zodBody(githubImportRequestSchema))
    body: { repoIds: number[]; overrides?: Record<string, DraftOverrides> },
  ) {
    return this.imports.import(user, tokenOf(req), body.repoIds, body.overrides);
  }

  @Post('import/preview')
  @HttpCode(200)
  @RateBudget('import')
  preview(
    @CurrentUser() user: UserRow,
    @Req() req: AuthenticatedRequest,
    @Body(zodBody(githubPreviewRequestSchema)) body: { repoIds: number[] },
  ) {
    return this.imports.preview(user, tokenOf(req), body.repoIds);
  }
}

/** Re-sync of one imported project (item 7); the project is the caller's or 404. */
@Controller('me/projects')
export class GithubSyncController {
  constructor(private readonly sync: GithubSyncService) {}

  @Post(':id/github/sync')
  @HttpCode(200)
  @RateBudget('import')
  resync(
    @CurrentUser() user: UserRow,
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query(zodQuery(githubSyncQuerySchema)) query: { dryRun?: 'true' | 'false' },
  ) {
    return this.sync.sync(user, tokenOf(req), id, query.dryRun === 'true');
  }
}
