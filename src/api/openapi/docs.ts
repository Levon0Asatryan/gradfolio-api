import type { INestApplication } from '@nestjs/common';
import { type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig } from '../../core/config/schema.js';
import { buildOpenApiDocument } from './document.js';

/** Where the browsable documentation is served, when it is served at all. */
export const DOCS_PATH = 'docs';

/**
 * Serves Swagger UI over the same document openapi.yaml is generated from, so
 * the page and the file can never disagree.
 *
 * Off unless API_DOCS_ENABLED: Swagger UI is a large piece of third-party
 * browser code with its own history of XSS advisories, and it exists for
 * people building against this API. docker compose turns it on.
 *
 * Returns whether it mounted, so the boot log can say so and a test can assert
 * the switch works in both directions.
 */
export function setupApiDocs(app: INestApplication, cfg: AppConfig): boolean {
  if (!cfg.API_DOCS_ENABLED) return false;

  SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument() as unknown as OpenAPIObject, {
    customSiteTitle: 'Gradfolio API',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 2,
    },
  });

  return true;
}
