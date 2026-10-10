import { type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  getOptionsToken,
  getStorageToken,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { RateLimitedError } from '../../../core/errors/app-error.js';
import type { AuthenticatedRequest } from '../../auth/auth.constants.js';
import { identify, secretDigests } from '../utils/client-identity.js';

/**
 * Global guard, after the access-token guard and before anything that touches
 * the database.
 *
 * Keyed by the verified `sub` when there is one: the frontend calls from its
 * server (Q11), so every user arrives from the same few Vercel addresses and
 * an address-keyed budget would be shared by all of them. Without a token, by
 * the visitor's address when the frontend vouched for it with the shared secret
 * (`X-Client-IP` + `X-Gradfolio-Proxy-Secret`, docs/m6-plan.md §2.4), else by
 * the connection's address, which follows TRUST_PROXY.
 *
 * The throttler's key generator is kept: it includes the budget's name, and a
 * custom one without it makes a second named budget never block
 * (nestjs/throttler#2709).
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  private readonly secrets: Buffer[];

  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storage: ThrottlerStorage,
    reflector: Reflector,
    @Inject(APP_CONFIG) cfg: AppConfig,
  ) {
    super(options, storage, reflector);
    this.secrets = secretDigests(cfg.PROXY_SHARED_SECRETS);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const who = identify(req as unknown as AuthenticatedRequest, this.secrets);
    if (who.kind === 'user') return `user:${who.sub}`;
    // `fwd:` and `ip:` never collide, whatever address the frontend forwards.
    if (who.kind === 'forwarded') return `fwd:${await super.getTracker({ ip: who.ip })}`;
    return `ip:${await super.getTracker(req)}`;
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
