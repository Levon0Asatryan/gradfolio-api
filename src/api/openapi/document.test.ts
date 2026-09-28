import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API_VERSION_PREFIX, UNVERSIONED_PATHS } from '../bootstrap.js';
import { buildApp, stubDb } from '../../testing/app.js';
import { testConfig } from '../../testing/database.js';
import { buildOpenApiDocument, OPERATIONS } from './document.js';

/** Every `METHOD /path` Nest actually serves, with the global prefix applied. */
function nestRoutes(app: NestExpressApplication): string[] {
  const scanner = new MetadataScanner();
  const routes: string[] = [];
  const controllers = [...app.get(ModulesContainer).values()].flatMap((m) => [
    ...m.controllers.values(),
  ]);

  for (const wrapper of controllers) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = (Reflect.getMetadata(PATH_METADATA, metatype) as string | undefined) ?? '';
    const proto = Object.getPrototypeOf(instance) as object;

    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = (proto as Record<string, unknown>)[name] as object;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) continue;

      const joined = [base, path]
        .map((p) => p.replace(/^\/|\/$/g, ''))
        .filter(Boolean)
        .join('/');
      const prefixed = UNVERSIONED_PATHS.includes(joined)
        ? `/${joined}`
        : `/${API_VERSION_PREFIX}/${joined}`;
      // Express `:id` to OpenAPI `{id}`.
      const openapiPath = prefixed.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      routes.push(`${RequestMethod[method].toLowerCase()} ${openapiPath}`);
    }
  }
  return routes.sort();
}

describe('openapi document', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await buildApp(testConfig({ LOG_LEVEL: 'fatal' }), stubDb());
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents exactly the routes Nest serves -- nothing missing, nothing extra', () => {
    const documented = OPERATIONS.map((op) => `${op.method} ${op.path}`).sort();
    expect(documented).toEqual(nestRoutes(app));
  });

  it('has unique operation ids', () => {
    const ids = OPERATIONS.map((op) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refers every error response to the shared ErrorResponse schema', () => {
    const doc = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.components.schemas).toHaveProperty('ErrorResponse');

    const readiness503 = doc.paths['/readyz']?.get?.responses['503'];
    expect(JSON.stringify(readiness503)).toContain('#/components/schemas/ErrorResponse');
  });

  it('keeps several methods on one path, and omits what an operation does not set', () => {
    const doc = buildOpenApiDocument([
      {
        method: 'get',
        path: '/v1/things/{id}',
        operationId: 'getThing',
        tag: 't',
        summary: 'get',
        responses: { '200': { description: 'ok', schema: z.object({ id: z.string() }) } },
      },
      {
        method: 'delete',
        path: '/v1/things/{id}',
        operationId: 'deleteThing',
        tag: 't',
        summary: 'delete',
        responses: { '204': { description: 'gone' } },
      },
    ]) as { paths: Record<string, Record<string, Record<string, unknown>>> };

    const item = doc.paths['/v1/things/{id}'];
    expect(Object.keys(item ?? {}).sort()).toEqual(['delete', 'get']);
    expect(item?.get).not.toHaveProperty('description');
    expect(item?.delete?.responses).toEqual({ '204': { description: 'gone' } });
  });
});
