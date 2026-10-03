import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { RateLimitedError } from '../../../core/errors/app-error.js';
import type { AuthenticatedRequest } from '../../auth/auth.constants.js';

/**
 * Global guard, after the access-token guard and before anything that touches
 * the database.
 *
 * Keyed by the verified `sub` when there is one: the frontend calls from its
 * server (Q11), so every user arrives from the same few Vercel addresses and
 * an address-keyed budget would be shared by all of them. Without a token,
 * keyed by the client address, which follows TRUST_PROXY.
 *
 * The throttler's key generator is kept: it includes the budget's name, and a
 * custom one without it makes a second named budget never block
 * (nestjs/throttler#2709).
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const { auth } = req as unknown as AuthenticatedRequest;
    return auth ? `user:${auth.sub}` : `ip:${await super.getTracker(req)}`;
  }

  /**
   * A named budget's own header would be `Retry-After-<name>`; clients read
   * the standard one. Seconds until the budget frees up.
   */
  protected override throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    return Promise.reject(new RateLimitedError(detail.timeToBlockExpire));
  }
}
