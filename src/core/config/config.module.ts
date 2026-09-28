import { Global, Module } from '@nestjs/common';
import { loadConfig } from './index.js';
import type { AppConfig } from './schema.js';

/** Injection token for the validated environment. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Provides the validated configuration through dependency injection, rather
 * than a module-level singleton: tests pass a value instead of mutating
 * `process.env` and resetting a cache.
 */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
