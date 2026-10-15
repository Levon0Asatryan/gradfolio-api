import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { AccessTokenIdentity } from '../../core/auth/access-token.js';
import type { AuthenticatedRequest } from '../auth/auth.constants.js';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import {
  type ConnectResponse,
  type DisconnectResponse,
  type IntegrationsResponse,
  type LinkRequest,
  linkRequestSchema,
  type LinkResponse,
} from './dto/integration.dto.js';
import { GithubConnectionService } from './services/github-connection.service.js';

/** The caller's verified token; the guard refuses a request without one. */
function tokenOf(req: AuthenticatedRequest): AccessTokenIdentity {
  if (req.auth === undefined) throw new Error('integrations route without a verified token');
  return req.auth;
}

/**
 * The caller's integrations (docs/m7-plan.md §7 items 1–4). A token is
 * required; no route takes an id, so nothing can point at another user's row.
 * Each route has its own counter under the `integration` budget.
 */
@Controller('me/integrations')
@RateBudget('integration')
export class IntegrationsController {
  constructor(private readonly github: GithubConnectionService) {}

  @Get()
  status(
    @CurrentUser() user: UserRow,
    @Req() req: AuthenticatedRequest,
  ): Promise<IntegrationsResponse> {
    return this.github.status(user, tokenOf(req));
  }

  @Post('github/connect')
  @HttpCode(200)
  connect(
    @CurrentUser() user: UserRow,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConnectResponse> {
    return this.github.connect(user, tokenOf(req));
  }

  @Post('github/link')
  @HttpCode(200)
  link(
    @CurrentUser() user: UserRow,
    @Body(zodBody(linkRequestSchema)) body: LinkRequest,
  ): Promise<LinkResponse> {
    return this.github.link(user, body.idToken);
  }

  @Delete('github')
  disconnect(
    @CurrentUser() user: UserRow,
    @Req() req: AuthenticatedRequest,
  ): Promise<DisconnectResponse> {
    return this.github.disconnect(user, tokenOf(req));
  }
}
