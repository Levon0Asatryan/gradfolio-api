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
    HealthModule,
  ],
  providers: [
    ErrorFilter,
    // Global guards run in the order listed here (run, docs/m2-plan.md §2.6).
    { provide: APP_GUARD, useClass: AccessTokenGuard },
  ],
})
export class AppModule {}
