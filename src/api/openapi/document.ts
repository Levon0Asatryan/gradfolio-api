import { z, type ZodObject, type ZodType } from 'zod';
import { LIVENESS_PATH, READINESS_PATH } from '../health/constants.js';
import { meResponseSchema } from '../me/dto/me.dto.js';
import {
  onboardingResponseSchema,
  profileHeaderSchema,
  profileSchema,
  updateProfileSchema,
  userIdParamSchema,
} from '../profiles/dto/profile.dto.js';

/**
 * The OpenAPI document, built from the same zod schemas the request pipeline
 * validates against -- so the contract cannot describe a shape the server does
 * not enforce. `npm run openapi` writes it to openapi.yaml; CI fails when the
 * committed file is stale; document.test.ts compares its operations against
 * Nest's route table in both directions.
 *
 * A new endpoint adds its operation to OPERATIONS in the same change.
 */

type JsonSchema = Record<string, unknown>;

/**
 * Converts a zod schema, moving every named sub-schema (`.meta({ id })`) into
 * `components`. zod emits those as `#/definitions/<id>` inside each converted
 * schema, which does not resolve from inside an OpenAPI document, so they are
 * hoisted and their references rewritten. The same id twice must be the same
 * schema: one component, one meaning.
 *
 * Requests convert as `input` (what a client may send, before the pipe's
 * transforms run); responses as `output`.
 */
function convert(
  schema: ZodType,
  components: Record<string, JsonSchema>,
  io: 'input' | 'output' = 'output',
): JsonSchema {
  const { definitions, ...rest } = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
  }) as JsonSchema & { definitions?: Record<string, JsonSchema> };

  for (const [name, def] of Object.entries(definitions ?? {})) {
    const rewritten = rewriteRefs(def);
    const existing = components[name];
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(rewritten)) {
      throw new Error(`two different schemas share the component name ${name}`);
    }
    components[name] = rewritten;
  }
  return rewriteRefs(rest);
}

function rewriteRefs(node: JsonSchema): JsonSchema {
  return JSON.parse(
    JSON.stringify(node).replaceAll('"#/definitions/', '"#/components/schemas/'),
  ) as JsonSchema;
}

export const errorResponseSchema = z.object({
  code: z.string().meta({
    description: 'Stable machine-readable code. Branch on this, never on `message`.',
    example: 'NOT_FOUND',
  }),
  message: z.string().meta({ description: 'Human-readable; not part of the contract.' }),
  details: z
    .unknown()
    .optional()
    .meta({ description: 'Field-level detail, for VALIDATION_FAILED only.' }),
});

const livenessSchema = z.object({ status: z.literal('ok') });
const readinessSchema = z.object({ status: z.literal('ok'), database: z.literal('ok') });

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface Operation {
  method: Method;
  /** OpenAPI path, e.g. `/v1/projects/{id}`. */
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description?: string;
  /** Path parameters, one key per `{name}` in `path`. */
  params?: ZodObject;
  /** The JSON request body. */
  body?: ZodType;
  responses: Record<string, { description: string; schema?: ZodType }>;
  /** Needs `Authorization: Bearer <Auth0 access token>`. Every route except `@Public()` ones. */
  bearer?: boolean;
}

const error = (description: string) => ({ description, schema: errorResponseSchema });

/** The failures every authenticated route shares. */
const authenticatedFailures = {
  '401': error('UNAUTHENTICATED: no access token, or one that is invalid or expired'),
  '429': error('RATE_LIMITED: over budget; see the Retry-After header'),
  '503': error(
    'AUTH_UNAVAILABLE: Auth0 signing keys unreachable, or DATABASE_UNAVAILABLE: MySQL unreachable',
  ),
};

const validationFailed = error(
  'VALIDATION_FAILED: the body does not fit the schema (see `details`)',
);

export const OPERATIONS: readonly Operation[] = [
  {
    method: 'get',
    path: `/${LIVENESS_PATH}`,
    operationId: 'liveness',
    tag: 'health',
    summary: 'Liveness: the process is running',
    description: 'Touches no dependency, so it stays 200 while the database is down.',
    responses: { '200': { description: 'Alive', schema: livenessSchema } },
  },
  {
    method: 'get',
    path: `/${READINESS_PATH}`,
    operationId: 'readiness',
    tag: 'health',
    summary: 'Readiness: the process can serve traffic',
    description: 'Runs `SELECT 1` against MySQL, bounded by HEALTH_TIMEOUT_MS.',
    responses: {
      '200': { description: 'Ready', schema: readinessSchema },
      '503': error('DATABASE_UNAVAILABLE: MySQL is unreachable or too slow'),
    },
  },
  {
    method: 'get',
    path: '/v1/me',
    operationId: 'getMe',
    tag: 'me',
    summary: 'The caller’s own account',
    description:
      'The first call after a login creates the account from the access token’s profile ' +
      'claims (name, email, picture); later calls return the same id. `verified` follows ' +
      'the token’s `email_verified`.',
    bearer: true,
    responses: {
      '200': { description: 'The caller’s account', schema: meResponseSchema },
      ...authenticatedFailures,
    },
  },
  {
    method: 'post',
    path: '/v1/me/onboarding/complete',
    operationId: 'completeOnboarding',
    tag: 'me',
    summary: 'Finish (or skip) first-login onboarding',
    description:
      'Sets `onboarded` on `GET /v1/me`. Idempotent: a repeat call keeps the first timestamp.',
    bearer: true,
    responses: {
      '200': { description: 'Onboarding is complete', schema: onboardingResponseSchema },
      '404': error('NOT_FOUND: the account no longer exists'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'get',
    path: '/v1/me/profile',
    operationId: 'getMyProfile',
    tag: 'profiles',
    summary: 'The caller’s editable profile header',
    bearer: true,
    responses: {
      '200': { description: 'The header', schema: profileHeaderSchema },
      '404': error('NOT_FOUND: the account no longer exists'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'patch',
    path: '/v1/me/profile',
    operationId: 'updateMyProfile',
    tag: 'profiles',
    summary: 'Change profile header fields',
    description:
      'Any non-empty subset of the fields. `null` (or a blank string) clears a nullable field; ' +
      '`links` changes only the keys it names. Unknown keys are rejected, so `verified`, ' +
      '`email` and the like cannot be written. `isPublic: false` hides the profile from ' +
      'everyone but the owner immediately.',
    bearer: true,
    body: updateProfileSchema,
    responses: {
      '200': { description: 'The header after the change', schema: profileHeaderSchema },
      '400': validationFailed,
      '404': error('NOT_FOUND: the account no longer exists'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'get',
    path: '/v1/users/{id}',
    operationId: 'getProfile',
    tag: 'profiles',
    summary: 'A profile with its sections',
    description:
      'Needs no token when the profile is public; a token, when sent, identifies the owner ' +
      '(`isOwner`). A private profile answers 404 to everyone but its owner, exactly as an ' +
      'unknown id does. A token that is sent but invalid is a 401, not an anonymous read. ' +
      'Never includes birthday, phone, the login email or any token.',
    params: userIdParamSchema,
    responses: {
      '200': { description: 'The profile', schema: profileSchema },
      '401': error('UNAUTHENTICATED: a token was sent and is invalid or expired'),
      '404': error('NOT_FOUND: no such profile, or it is private and the caller is not its owner'),
      '429': error('RATE_LIMITED: over budget; see the Retry-After header'),
      '503': error('AUTH_UNAVAILABLE or DATABASE_UNAVAILABLE'),
    },
  },
];

export function buildOpenApiDocument(
  operations: readonly Operation[] = OPERATIONS,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const components: Record<string, JsonSchema> = {};

  for (const op of operations) {
    const responses: Record<string, unknown> = {};
    for (const [status, r] of Object.entries(op.responses)) {
      responses[status] = {
        description: r.description,
        ...(r.schema
          ? {
              content: {
                'application/json': {
                  schema:
                    r.schema === errorResponseSchema
                      ? { $ref: '#/components/schemas/ErrorResponse' }
                      : convert(r.schema, components),
                },
              },
            }
          : {}),
      };
    }

    paths[op.path] ??= {};
    paths[op.path]![op.method] = {
      operationId: op.operationId,
      tags: [op.tag],
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      ...(op.bearer ? { security: [{ bearerAuth: [] }] } : {}),
      ...(op.params ? { parameters: pathParameters(op, components) } : {}),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: convert(op.body, components, 'input') } },
            },
          }
        : {}),
      responses,
    };
  }

  // The component is the schema itself. Giving the zod schema an `id` would
  // make toJSONSchema emit a root `$ref` into a `definitions` map, which does
  // not resolve from inside an OpenAPI document.
  const errorSchema = convert(errorResponseSchema, components);

  return {
    openapi: '3.0.3',
    info: {
      title: 'Gradfolio API',
      version: '0.1.0',
      description:
        'Backend for Gradfolio, a student portfolio platform. Every route except the health ' +
        'checks is under `/v1` and needs an Auth0 access token, except reading a public profile ' +
        '(`GET /v1/users/{id}`). Every failure answers with ' +
        'an `ErrorResponse`.',
      license: { name: 'MIT' },
    },
    tags: [
      { name: 'health', description: 'Liveness and readiness, outside `/v1`' },
      { name: 'me', description: 'The caller’s own account' },
      { name: 'profiles', description: 'Profiles: reading anyone’s, editing your own' },
    ],
    paths,
    components: {
      schemas: { ErrorResponse: errorSchema, ...sortedByName(components) },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'An Auth0 access token for the Gradfolio API audience.',
        },
      },
    },
  };
}

function pathParameters(op: Operation, components: Record<string, JsonSchema>): unknown[] {
  const names = [...op.path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
  const shape = op.params?.shape ?? {};
  if (names.join() !== Object.keys(shape).join()) {
    throw new Error(`${op.operationId}: params must list exactly the {names} in ${op.path}`);
  }
  return Object.entries(shape).map(([name, schema]) => ({
    name,
    in: 'path',
    required: true,
    schema: convert(schema as ZodType, components, 'input'),
  }));
}

function sortedByName(components: Record<string, JsonSchema>): Record<string, JsonSchema> {
  return Object.fromEntries(Object.entries(components).sort(([a], [b]) => a.localeCompare(b)));
}
