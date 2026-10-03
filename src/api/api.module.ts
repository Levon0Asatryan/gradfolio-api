import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, ConfigModule } from '../core/config/config.module.js';
import type { AppConfig } from '../core/config/schema.js';
import { DbModule } from '../core/db/db.module.js';
import { LOG_DESTINATION, loggerOptions } from '../core/logging/index.js';
import { LoggingModule } from '../core/logging/logging.module.js';
import type { DestinationStream } from 'pino';
import { AuthModule } from './auth/auth.module.js';
import { AccessTokenGuard } from './auth/guards/access-token.guard.js';
import { ErrorFilter } from './common/filters/error.filter.js';
import { HealthModule } from './health/health.module.js';
import { RateLimitGuard } from './rate-limit/guards/rate-limit.guard.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { CurrentUserGuard } from './users/guards/current-user.guard.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG, LOG_DESTINATION],
      useFactory: (cfg: AppConfig, destination: DestinationStream | null) =>
        loggerOptions(cfg, destination),
    }),
    DbModule,
    AuthModule,
    RateLimitModule,
    UsersModule,
    HealthModule,
  ],
  providers: [
    ErrorFilter,
    // Global guards run in the order listed here (run, docs/m2-plan.md §2.6):
    // the token first, so the rate limit can key on the verified caller.
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Last: resolves the caller's row, after the limit so a flood never
    // reaches MySQL.
    { provide: APP_GUARD, useClass: CurrentUserGuard },
  ],
})
export class AppModule {}
