import { type INestApplication, NotFoundException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { AppConfig } from '../core/config/index.js';
import { toErrorResponse } from '../core/errors/http-mapping.js';
import { ErrorFilter } from './common/filters/error.filter.js';
import { HEALTH_PATHS } from './health/constants.js';

export const API_VERSION_PREFIX = 'v1';

/**
 * Paths served outside the version prefix, because a platform's health probe
 * should not have to track API versions. Explicit paths only: Nest matches
 * every `exclude` entry against every route, so a wildcard would exclude the
 * whole API from the prefix.
 */
export const UNVERSIONED_PATHS = HEALTH_PATHS;

/**
 * Applies every cross-cutting concern. Separate from main.ts so the setup is
 * a value tests can build and assert on.
 */
export function configureApp(app: NestExpressApplication, cfg: AppConfig): INestApplication {
  // Adding a prefix once clients exist is a breaking change, so it goes in first.
  app.setGlobalPrefix(API_VERSION_PREFIX, { exclude: UNVERSIONED_PATHS });

  // One response shape for every failure, with no internal detail in any.
  app.useGlobalFilters(app.get(ErrorFilter));

  // Rejecting an oversized body early keeps a hostile payload from a parser.
  app.useBodyParser('json', { limit: cfg.API_BODY_LIMIT });

  // A free hint naming the framework to fingerprint; nothing legitimate reads it.
  app.disable('x-powered-by');

  // Whether X-Forwarded-For may be believed -- off unless a deployment opts in.
  app.set('trust proxy', cfg.TRUST_PROXY);

  // Closes the module tree on SIGTERM, which ends the database pool.
  app.enableShutdownHooks();

  return app;
}

/**
 * Answers every request no route matched with the same JSON shape as any other
 * failure, instead of Express's HTML error page.
 *
 * Express middleware registered after `init()`, so it sits behind Nest's
 * router: inside the `/v1` prefix Nest raises NotFoundException itself; this
 * covers every path outside it. Both answer identically.
 */
export async function registerNotFoundFallback(app: NestExpressApplication): Promise<void> {
  await app.init();

  const { status, body } = toErrorResponse(new NotFoundException());

  app.use((_req: Request, res: Response) => {
    res.status(status).json(body);
  });
}
