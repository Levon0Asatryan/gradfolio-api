import { Writable } from 'node:stream';
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../api/api.module.js';
import { configureApp, registerNotFoundFallback } from '../api/bootstrap.js';
import { setupApiDocs } from '../api/openapi/docs.js';
import { APP_CONFIG } from '../core/config/config.module.js';
import type { AppConfig } from '../core/config/schema.js';
import { DbService } from '../core/db/db.service.js';
import { LOG_DESTINATION } from '../core/logging/index.js';
import type { AccessTokenIdentity } from '../core/auth/access-token.js';
import type { UserRow } from '../api/users/repositories/user.repository.js';
import { UsersService } from '../api/users/services/users.service.js';

export interface BuildOptions {
  /** Extra controllers, for routes the application does not have yet. */
  controllers?: Type[];
  /** Receives every log line the application writes. */
  logs?: LogCapture;
}

/**
 * Builds the real application the way main.ts does -- same module, same
 * configureApp, same docs and fallback order -- with the config supplied and,
 * optionally, the database replaced.
 */
export async function buildApp(
  cfg: AppConfig,
  db?: Pick<DbService, 'ping' | 'onModuleDestroy'>,
  { controllers = [], logs }: BuildOptions = {},
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule], controllers })
    .overrideProvider(APP_CONFIG)
    .useValue(cfg);
  if (db) {
    // Without a database there is no row to resolve: the caller gets a
    // synthetic one, so unit-level HTTP tests can reach protected routes.
    // Integration tests (real MySQL) pass no `db` and get the real resolver.
    builder = builder
      .overrideProvider(DbService)
      .useValue(db)
      .overrideProvider(UsersService)
      .useValue(stubUsers);
  }
  if (logs) builder = builder.overrideProvider(LOG_DESTINATION).useValue(logs.stream);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app, cfg);
  setupApiDocs(app, cfg);
  await registerNotFoundFallback(app);
  // Listen on an explicit loopback address before supertest sees the server.
  // Left to itself, supertest binds the wildcard address on a random port and
  // connects to 127.0.0.1:<port>; when another server in the run bound
  // 127.0.0.1 on that same port (the OS allows a specific and a wildcard bind
  // side by side), the request reaches the wrong server and answers 404.
  await app.listen(0, '127.0.0.1');
  return app;
}

export const stubDb = (ping: (timeoutMs: number) => Promise<void> = () => Promise.resolve()) => ({
  ping,
  onModuleDestroy: () => Promise.resolve(),
});

/**
 * Collects what the application logs, as raw text and as parsed lines.
 *
 * Create **one per test file** and `clear()` it between tests: nestjs-pino
 * keeps its root logger in a static, so injected loggers (the error filter's)
 * keep writing to the destination of the first application built in the
 * process, whichever application is running now.
 */
export interface LogCapture {
  stream: Writable;
  text: () => string;
  lines: () => Record<string, unknown>[];
  clear: () => void;
}

export function captureLogs(): LogCapture {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const text = () => chunks.join('');
  return {
    stream,
    text,
    clear: () => {
      chunks.length = 0;
    },
    lines: () =>
      text()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

/** UsersService without a database: a row made from the token, never stored. */
export const stubUsers: Pick<UsersService, 'resolve'> = {
  resolve: (identity: AccessTokenIdentity): Promise<UserRow> =>
    Promise.resolve({
      id: `stub-${identity.sub}`,
      auth0Id: identity.sub,
      name: identity.name ?? 'Stub User',
      headline: '',
      location: null,
      verified: identity.emailVerified,
      isPublic: true,
      email: identity.email ?? null,
      contactEmail: null,
      onboardedAt: null,
      avatarUrl: null,
      bio: null,
      github: null,
      linkedin: null,
      twitter: null,
      website: null,
      phone: null,
      birthday: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
};
