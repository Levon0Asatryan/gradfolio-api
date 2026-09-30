import { Controller, Get, Req } from '@nestjs/common';
import { Public } from '../api/auth/decorators/public.decorator.js';
import type { AuthenticatedRequest } from '../api/auth/auth.constants.js';

/**
 * Routes for testing the global guards before the application has routes of
 * its own that need them. Registered only by tests (buildApp's `controllers`).
 */
@Controller('probe')
export class ProbeController {
  /** Protected by default: no decorator. */
  @Get()
  whoami(@Req() req: AuthenticatedRequest): { sub: string | undefined } {
    return { sub: req.auth?.sub };
  }

  @Public()
  @Get('public')
  open(@Req() req: AuthenticatedRequest): { sub: string | undefined } {
    return { sub: req.auth?.sub };
  }
}
