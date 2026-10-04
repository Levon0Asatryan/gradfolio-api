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

  it('resolves every $ref it contains', () => {
    const doc = buildOpenApiDocument();
    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') refs.push(value);
        else walk(value);
      }
    };
    walk(doc);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('#/'), ref).toBe(true);
      const target = ref
        .slice(2)
        .split('/')
        .reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], doc);
      expect(target, `${ref} does not resolve`).toBeTypeOf('object');
      expect(target, `${ref} is itself only a $ref`).not.toHaveProperty('$ref');
    }
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

  it('hoists named schemas into components and leaves no #/definitions behind', () => {
    const doc = buildOpenApiDocument() as { components: { schemas: Record<string, unknown> } };
    for (const name of ['Profile', 'ProfileHeader', 'Education', 'Experience', 'Certification']) {
      expect(doc.components.schemas, name).toHaveProperty(name);
    }
    expect(JSON.stringify(doc)).not.toContain('#/definitions');
  });

  it('documents path parameters and request bodies', () => {
    const doc = buildOpenApiDocument() as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    expect(doc.paths['/v1/users/{id}']?.get?.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    ]);
    expect(doc.paths['/v1/me/profile']?.patch?.requestBody).toMatchObject({ required: true });
  });

  it('refuses params that do not match the {names} in the path', () => {
    const op = {
      method: 'get' as const,
      path: '/v1/a/{id}',
      operationId: 'a',
      tag: 't',
      summary: 's',
      params: z.object({ other: z.string() }),
      responses: { '200': { description: 'ok' } },
    };
    expect(() => buildOpenApiDocument([op])).toThrow(/params must list/);
  });

  it('refuses two different schemas under one component name', () => {
    const one = z.object({ a: z.string() }).meta({ id: 'Same' });
    const two = z.object({ b: z.string() }).meta({ id: 'Same' });
    const op = (operationId: string, schema: z.ZodType) => ({
      method: 'get' as const,
      path: `/v1/${operationId}`,
      operationId,
      tag: 't',
      summary: 's',
      responses: { '200': { description: 'ok', schema } },
    });
    expect(() => buildOpenApiDocument([op('x', one), op('y', two)])).toThrow(/share the component/);
  });

  it('exposes no private field in any schema, and the login email only on GET /v1/me', () => {
    const doc = buildOpenApiDocument() as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    const forbidden = new Set([
      'auth0Id',
      'auth0_id',
      'phone',
      'birthday',
      'accessToken',
      'refreshToken',
      'externalUserId',
      'tokenExpiresAt',
    ]);
    const keys = (node: unknown, out: string[] = []): string[] => {
      if (Array.isArray(node)) node.forEach((n) => keys(n, out));
      else if (node !== null && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          out.push(k);
          keys(v, out);
        }
      }
      return out;
    };
    expect(keys(doc).filter((k) => forbidden.has(k))).toEqual([]);

    const hasEmail = (node: unknown) => keys(node).includes('email');
    expect(hasEmail(doc.components.schemas)).toBe(false);
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const isMe = path === '/v1/me' && method === 'get';
        expect(hasEmail(op), `${method} ${path}`).toBe(isMe);
      }
    }
  });
});
