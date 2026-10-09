import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { seconds, ThrottlerModule, type ThrottlerOptions } from '@nestjs/throttler';
import { APP_CONFIG } from '../../core/config/config.module.js';
import type { AppConfig } from '../../core/config/schema.js';
import { RATE_BUDGET, type RateBudgetName } from './rate-limit.constants.js';

const reflector = new Reflector();

/** A named budget applies only where a route opted in with @RateBudget(name). */
function onlyWhereOptedIn(name: RateBudgetName): ThrottlerOptions['skipIf'] {
  return (ctx) =>
    reflector.getAllAndOverride<RateBudgetName | undefined>(RATE_BUDGET, [
      ctx.getHandler(),
      ctx.getClass(),
    ]) !== name;
}

/**
 * In-memory budgets: exact for the one api process this project runs (Q9); a
 * second instance would need shared storage. The throttler measures `ttl` in
 * milliseconds.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => {
        const ttl = seconds(cfg.RATE_LIMIT_WINDOW_S);
        return {
          // The guard sends Retry-After itself; the per-budget headers would
          // name each budget (`X-RateLimit-Limit-search`).
          setHeaders: false,
          throttlers: [
            { name: 'default', ttl, limit: cfg.RATE_LIMIT_DEFAULT },
            {
              name: 'search',
              ttl,
              limit: cfg.RATE_LIMIT_SEARCH,
              skipIf: onlyWhereOptedIn('search'),
            },
            {
              name: 'import',
              ttl,
              limit: cfg.RATE_LIMIT_IMPORT,
              skipIf: onlyWhereOptedIn('import'),
            },
            { name: 'ai', ttl, limit: cfg.RATE_LIMIT_AI, skipIf: onlyWhereOptedIn('ai') },
            {
              name: 'lookup',
              ttl,
              limit: cfg.RATE_LIMIT_LOOKUP,
              skipIf: onlyWhereOptedIn('lookup'),
            },
            {
              name: 'upload',
              ttl,
              limit: cfg.RATE_LIMIT_UPLOAD,
              skipIf: onlyWhereOptedIn('upload'),
            },
          ],
        };
      },
    }),
  ],
})
export class RateLimitModule {}
