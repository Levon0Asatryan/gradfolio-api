import { z, type ZodObject, type ZodType } from 'zod';
import { LIVENESS_PATH, READINESS_PATH } from '../health/constants.js';
import { meResponseSchema } from '../me/dto/me.dto.js';
import { documentedProjectSchemas } from '../projects/dto/project-write.dto.js';
import {
  myProjectsQuerySchema,
  projectDetailSchema,
  projectIdParamSchema,
  projectPageSchema,
  userProjectsQuerySchema,
} from '../projects/dto/project.dto.js';
import {
  certificationSchema,
  educationSchema,
  experienceSchema,
  onboardingResponseSchema,
  profileHeaderSchema,
  profileSchema,
  updateProfileSchema,
  userIdParamSchema,
} from '../profiles/dto/profile.dto.js';
import {
  createCertificationSchema,
  createEducationSchema,
  createExperienceSchema,
  itemIdParamSchema,
  nonEmptyPatch,
  patchCertificationSchema,
  patchEducationSchema,
  patchExperienceSchema,
  reorderSchema,
  replaceSkillsSchema,
  skillsResponseSchema,
} from '../profiles/dto/section.dto.js';

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
  /** Query-string parameters; optional ones are those the schema marks optional. */
  query?: ZodObject;
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

const notYours = (what: string) =>
  error(`NOT_FOUND: no such ${what} of the caller's (someone else's id answers the same)`);

/** The five operations every ordered profile section has. */
function sectionOperations(s: {
  path: string;
  name: string;
  plural: string;
  item: ZodType;
  create: ZodType;
  patch: ZodObject;
}): Operation[] {
  const list = z.array(s.item);
  const base = { tag: 'profiles', bearer: true } as const;
  return [
    {
      ...base,
      method: 'post',
      path: `/v1/me/${s.path}`,
      operationId: `create${s.name}`,
      summary: `Add a ${s.plural} entry`,
      description:
        'The new entry goes first. Required fields must be non-empty; `null` or a blank string ' +
        'clears an optional text field. Over the per-user cap: 409 `LIMIT_REACHED`.',
      body: s.create,
      responses: {
        '201': { description: 'The new entry', schema: s.item },
        '400': validationFailed,
        '409': error('LIMIT_REACHED: the section is full'),
        ...authenticatedFailures,
      },
    },
    {
      ...base,
      method: 'patch',
      path: `/v1/me/${s.path}/{id}`,
      operationId: `update${s.name}`,
      summary: `Change a ${s.plural} entry`,
      description:
        'Any non-empty subset of the fields; the result is validated as a whole, so ' +
        'cross-field rules hold. Unknown keys (`id`, `userId`, `sortOrder` …) are rejected.',
      params: itemIdParamSchema,
      body: nonEmptyPatch(s.patch as never),
      responses: {
        '200': { description: 'The entry after the change', schema: s.item },
        '400': validationFailed,
        '404': notYours(`${s.plural} entry`),
        ...authenticatedFailures,
      },
    },
    {
      ...base,
      method: 'delete',
      path: `/v1/me/${s.path}/{id}`,
      operationId: `delete${s.name}`,
      summary: `Delete a ${s.plural} entry`,
      params: itemIdParamSchema,
      responses: {
        '204': { description: 'Deleted' },
        '404': notYours(`${s.plural} entry`),
        ...authenticatedFailures,
      },
    },
    {
      ...base,
      method: 'put',
      path: `/v1/me/${s.path}/order`,
      operationId: `reorder${s.name}`,
      summary: `Set the order of the ${s.plural} section`,
      description:
        'Atomic. `ids` must be exactly the caller’s entries, each once. An id that is not ' +
        'the caller’s is 404; the right ids but an incomplete list (an entry was added ' +
        'elsewhere) is 409 `ORDER_STALE`.',
      body: reorderSchema,
      responses: {
        '200': { description: 'The section in its new order', schema: list },
        '400': validationFailed,
        '404': notYours(`${s.plural} entry`),
        '409': error('ORDER_STALE: the list changed; reload it and try again'),
        ...authenticatedFailures,
      },
    },
  ];
}

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
    method: 'delete',
    path: '/v1/me',
    operationId: 'deleteMe',
    tag: 'me',
    summary: 'Delete the caller’s account and all its data',
    description:
      'Removes the profile, every section, skills, projects (with attachments, tags and team ' +
      'rows), integrations and notifications. The caller’s name stays on other people’s ' +
      'projects as a plain team-member name, without a photo or a link to an account. ' +
      'Irreversible. The Auth0 login is not deleted: sign the user out afterwards, because a ' +
      'token that is still valid creates a new, empty account on its next request.',
    bearer: true,
    responses: {
      '204': { description: 'Deleted' },
      '404': error('NOT_FOUND: the account no longer exists'),
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
  {
    method: 'put',
    path: '/v1/me/skills',
    operationId: 'replaceSkills',
    tag: 'profiles',
    summary: 'Replace the whole skill list',
    description:
      'One transaction. The order given is the order kept; names are normalized and ' +
      'case-insensitive duplicates collapse, with one spelling per name across the site. ' +
      'Over the per-user cap: 400.',
    bearer: true,
    body: replaceSkillsSchema,
    responses: {
      '200': { description: 'The canonical list', schema: skillsResponseSchema },
      '400': validationFailed,
      ...authenticatedFailures,
    },
  },
  {
    method: 'get',
    path: '/v1/projects/{id}',
    operationId: 'getProject',
    tag: 'projects',
    summary: 'A project with its attachments, tags, technologies and team',
    description:
      'Needs no token when the project is public and published; a token, when sent, ' +
      'identifies the owner (`isOwner`), who also reads their private and draft projects. ' +
      'A project the caller may not read answers 404, exactly as an unknown id does. A token ' +
      'that is sent but invalid is a 401, not an anonymous read. `descriptionHtml` is ' +
      'sanitized on write; video attachments carry an `embedUrl` to use in an iframe.',
    params: projectIdParamSchema,
    responses: {
      '200': { description: 'The project', schema: projectDetailSchema },
      '401': error('UNAUTHENTICATED: a token was sent and is invalid or expired'),
      '404': error(
        'NOT_FOUND: no such project, or it is private/draft and the caller is not its owner',
      ),
      '429': error('RATE_LIMITED: over budget; see the Retry-After header'),
      '503': error('AUTH_UNAVAILABLE or DATABASE_UNAVAILABLE'),
    },
  },
  {
    method: 'post',
    path: '/v1/projects',
    operationId: 'createProject',
    tag: 'projects',
    summary: 'Create a project',
    description:
      'Only `title` is required. A new project is public and published unless `isPublic: false` ' +
      'or `isDraft: true`. `descriptionHtml` is sanitized with an allow-list on the way in ' +
      '(the response shows what was kept; the limit is measured after sanitizing). ' +
      '`technologies` and `tags` are normalized, de-duplicated case-insensitively and take ' +
      'the site-wide spelling. Unknown keys (`id`, `userId`, `source`, `repo…`, `aiSummary`) ' +
      'are rejected. Over the per-user cap: 409 `LIMIT_REACHED`.',
    bearer: true,
    body: documentedProjectSchemas.create,
    responses: {
      '201': { description: 'The new project', schema: projectDetailSchema },
      '400': validationFailed,
      '409': error('LIMIT_REACHED: the user holds the maximum number of projects'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'patch',
    path: '/v1/projects/{id}',
    operationId: 'updateProject',
    tag: 'projects',
    summary: 'Change project fields',
    description:
      'Any non-empty subset of the create fields; `metadata` changes only the keys it names; ' +
      '`technologies`, `tags`, `links` and `files` are replaced as whole lists. The result is ' +
      'validated as a whole, so cross-field rules hold. Someone else’s project, a deleted one ' +
      'and an unknown id all answer 404. A change that alters nothing is a 200.',
    bearer: true,
    params: projectIdParamSchema,
    body: documentedProjectSchemas.patch,
    responses: {
      '200': { description: 'The project after the change', schema: projectDetailSchema },
      '400': validationFailed,
      '404': notYours('project'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'delete',
    path: '/v1/projects/{id}',
    operationId: 'deleteProject',
    tag: 'projects',
    summary: 'Delete a project',
    description: 'Removes the project with its attachments, tags, technologies and team rows.',
    bearer: true,
    params: projectIdParamSchema,
    responses: {
      '204': { description: 'Deleted' },
      '404': notYours('project'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'get',
    path: '/v1/me/projects',
    operationId: 'listMyProjects',
    tag: 'projects',
    summary: 'The caller’s own projects, in every state',
    description:
      'Published, private and draft projects together; `state` narrows. Keyset pagination: ' +
      'pass `nextCursor` back as `cursor` with the same `sort`. Unknown query keys, a cursor ' +
      'for another sort and a `limit` over the maximum are 400.',
    bearer: true,
    query: myProjectsQuerySchema,
    responses: {
      '200': { description: 'One page', schema: projectPageSchema },
      '400': error('VALIDATION_FAILED: a query parameter is invalid (see `details`)'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'get',
    path: '/v1/users/{id}/projects',
    operationId: 'listUserProjects',
    tag: 'projects',
    summary: 'A user’s public projects',
    description:
      'Public, published projects only, even for the owner (who uses `/v1/me/projects`). ' +
      'Needs no token. 404 when the user’s profile is private and the caller is not its ' +
      'owner, or the user does not exist. Same pagination as `/v1/me/projects`.',
    params: userIdParamSchema,
    query: userProjectsQuerySchema,
    responses: {
      '200': { description: 'One page', schema: projectPageSchema },
      '400': error('VALIDATION_FAILED: a query parameter is invalid (see `details`)'),
      '401': error('UNAUTHENTICATED: a token was sent and is invalid or expired'),
      '404': error(
        'NOT_FOUND: no such user, or their profile is private and the caller is not its owner',
      ),
      '429': error('RATE_LIMITED: over budget; see the Retry-After header'),
      '503': error('AUTH_UNAVAILABLE or DATABASE_UNAVAILABLE'),
    },
  },
  ...sectionOperations({
    path: 'education',
    name: 'Education',
    plural: 'education',
    item: educationSchema,
    create: createEducationSchema,
    patch: patchEducationSchema,
  }),
  ...sectionOperations({
    path: 'experience',
    name: 'Experience',
    plural: 'experience',
    item: experienceSchema,
    create: createExperienceSchema,
    patch: patchExperienceSchema,
  }),
  ...sectionOperations({
    path: 'certifications',
    name: 'Certification',
    plural: 'certification',
    item: certificationSchema,
    create: createCertificationSchema,
    patch: patchCertificationSchema,
  }),
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
      ...(op.params || op.query
        ? { parameters: [...pathParameters(op, components), ...queryParameters(op, components)] }
        : {}),
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
      {
        name: 'projects',
        description: 'Projects: reading anyone’s public ones, managing your own',
      },
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

function queryParameters(op: Operation, components: Record<string, JsonSchema>): unknown[] {
  return Object.entries(op.query?.shape ?? {}).map(([name, schema]) => {
    const zodSchema = schema as ZodType;
    return {
      name,
      in: 'query',
      required: !zodSchema.isOptional(),
      schema: convert(zodSchema, components, 'input'),
    };
  });
}

function sortedByName(components: Record<string, JsonSchema>): Record<string, JsonSchema> {
  return Object.fromEntries(Object.entries(components).sort(([a], [b]) => a.localeCompare(b)));
}
