import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../api/api.module.js';
import { configureApp, registerNotFoundFallback } from '../api/bootstrap.js';
import { setupApiDocs } from '../api/openapi/docs.js';
import { APP_CONFIG } from '../core/config/config.module.js';
import type { AppConfig } from '../core/config/schema.js';
import { DbService } from '../core/db/db.service.js';

/**
 * Builds the real application the way main.ts does -- same module, same
 * configureApp, same docs and fallback order -- with the config supplied and,
 * optionally, the database replaced.
 */
export async function buildApp(
  cfg: AppConfig,
  db?: Pick<DbService, 'ping' | 'onModuleDestroy'>,
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(cfg);
  if (db) builder = builder.overrideProvider(DbService).useValue(db);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app, cfg);
  setupApiDocs(app, cfg);
  await registerNotFoundFallback(app);
  return app;
}

export const stubDb = (ping: (timeoutMs: number) => Promise<void> = () => Promise.resolve()) => ({
  ping,
  onModuleDestroy: () => Promise.resolve(),
});
