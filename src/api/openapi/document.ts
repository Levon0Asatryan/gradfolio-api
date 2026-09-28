import { z, type ZodType } from 'zod';
import { LIVENESS_PATH, READINESS_PATH } from '../health/constants.js';

/**
 * The OpenAPI document, built from the same zod schemas the request pipeline
 * validates against -- so the contract cannot describe a shape the server does
 * not enforce. `npm run openapi` writes it to openapi.yaml; CI fails when the
 * committed file is stale; document.test.ts compares its operations against
 * Nest's route table in both directions.
 *
 * A new endpoint adds its operation to OPERATIONS in the same change.
 */

function schemaOf(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'openapi-3.0' });
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
  responses: Record<string, { description: string; schema?: ZodType }>;
}

const error = (description: string) => ({ description, schema: errorResponseSchema });

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
];

export function buildOpenApiDocument(
  operations: readonly Operation[] = OPERATIONS,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

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
                      : schemaOf(r.schema),
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
      responses,
    };
  }

  // The component is the schema itself. Giving the zod schema an `id` would
  // make toJSONSchema emit a root `$ref` into a `definitions` map, which does
  // not resolve from inside an OpenAPI document.
  const errorSchema = schemaOf(errorResponseSchema);

  return {
    openapi: '3.0.3',
    info: {
      title: 'Gradfolio API',
      version: '0.1.0',
      description:
        'Backend for Gradfolio, a student portfolio platform. Every route except the health ' +
        'checks is under `/v1`. Every failure answers with an `ErrorResponse`.',
      license: { name: 'MIT' },
    },
    tags: [{ name: 'health', description: 'Liveness and readiness, outside `/v1`' }],
    paths,
    components: { schemas: { ErrorResponse: errorSchema } },
  };
}
