import { z, type ZodObject, type ZodType } from 'zod';
import { LIVENESS_PATH, READINESS_PATH } from '../health/constants.js';
import { meResponseSchema } from '../me/dto/me.dto.js';
import {
  attachmentParamsSchema,
  createAttachmentSchema,
  patchAttachmentSchema,
} from '../projects/dto/attachment.dto.js';
import { activityPageSchema, activityQuerySchema } from '../activities/dto/activity.dto.js';
import {
  notificationIdParamSchema,
  notificationPageSchema,
  notificationQuerySchema,
  readAllResultSchema,
  unreadCountSchema,
} from '../notifications/dto/notification.dto.js';
import {
  addExternalMemberSchema,
  inviteMemberSchema,
  lookupQuerySchema,
  lookupResultSchema,
  memberParamsSchema,
  projectTeamParamSchema,
  teamListSchema,
  teamMemberSchema,
} from '../team/dto/team.dto.js';
import { uploadRequestSchema, uploadResponseSchema } from '../files/dto/upload.dto.js';
import { documentedProjectSchemas } from '../projects/dto/project-write.dto.js';
import {
  myProjectsQuerySchema,
  projectDetailSchema,
  projectAttachmentSchema,
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
      'An accepted team member also reads a private project (never a draft). ' +
      'A project the caller may not read answers 404, exactly as an unknown id does. A token ' +
      'that is sent but invalid is a 401, not an anonymous read. `descriptionHtml` is ' +
      'sanitized on write; video attachments carry an `embedUrl` to use in an iframe.',
    params: projectIdParamSchema,
    responses: {
      '200': { description: 'The project', schema: projectDetailSchema },
      '401': error('UNAUTHENTICATED: a token was sent and is invalid or expired'),
      '404': error(
        'NOT_FOUND: no such project, or it is private/draft and the caller is neither its owner nor (private only) an accepted team member',
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
    method: 'post',
    path: '/v1/projects/{id}/attachments',
    operationId: 'addAttachment',
    tag: 'projects',
    summary: 'Add an attachment to a project',
    description:
      'Placed last. Every URL is https without credentials. `image` and `pdf` may be an ' +
      'uploaded file (the `fileUrl` of `POST /v1/me/uploads`, registered here once) or an ' +
      'external URL. `video` must be a YouTube or Vimeo link; the server computes ' +
      '`embedUrl` and the thumbnail. `link` cannot point at an uploaded file. At the ' +
      'per-project cap: 409 `LIMIT_REACHED`. A file that is not the caller’s, missing, of ' +
      'the wrong type or size, or already registered: 400 `INVALID_FILE` / `FILE_IN_USE`.',
    bearer: true,
    params: projectIdParamSchema,
    body: createAttachmentSchema,
    responses: {
      '201': { description: 'The new attachment', schema: projectAttachmentSchema },
      '400': validationFailed,
      '404': notYours('project'),
      '409': error('LIMIT_REACHED: the project holds the maximum number of attachments'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'patch',
    path: '/v1/projects/{id}/attachments/{attachmentId}',
    operationId: 'updateAttachment',
    tag: 'projects',
    summary: 'Change an attachment’s title or URL',
    description:
      'The type is fixed. A new `url` is validated for that type; replacing an uploaded ' +
      'file deletes the old object. Sending back the same file (even its signed read URL) ' +
      'keeps it.',
    bearer: true,
    params: attachmentParamsSchema,
    body: patchAttachmentSchema,
    responses: {
      '200': { description: 'The attachment after the change', schema: projectAttachmentSchema },
      '400': validationFailed,
      '404': notYours('attachment'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'delete',
    path: '/v1/projects/{id}/attachments/{attachmentId}',
    operationId: 'deleteAttachment',
    tag: 'projects',
    summary: 'Delete an attachment',
    description: 'An uploaded file is deleted from storage after the row is gone.',
    bearer: true,
    params: attachmentParamsSchema,
    responses: {
      '204': { description: 'Deleted' },
      '404': notYours('attachment'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'put',
    path: '/v1/projects/{id}/attachments/order',
    operationId: 'reorderAttachments',
    tag: 'projects',
    summary: 'Set the order of a project’s attachments',
    description:
      'Atomic. `ids` must be exactly the project’s attachments, each once. An id that is ' +
      'not this project’s is 404; the right ids but an incomplete list is 409 `ORDER_STALE`.',
    bearer: true,
    params: projectIdParamSchema,
    body: reorderSchema,
    responses: {
      '200': {
        description: 'The attachments in their new order',
        schema: z.array(projectAttachmentSchema),
      },
      '400': validationFailed,
      '404': notYours('attachment'),
      '409': error('ORDER_STALE: the list changed; reload it and try again'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'post',
    path: '/v1/me/uploads',
    operationId: 'createUpload',
    tag: 'projects',
    summary: 'Get a signed URL to upload an avatar, hero image, image or PDF',
    description:
      'The browser then PUTs the file straight to storage with the returned `headers` ' +
      '(exactly: type, size and a create-only precondition are signed; the URL writes its key once ' +
      'and a replay is refused), and the app sends `fileUrl` in the matching ' +
      'write. The URL lives `expiresAt`; the token never reaches the browser. Images: png, ' +
      'jpeg, webp, gif; PDFs only as an attachment. `hero` and `attachment` need a ' +
      '`projectId` of the caller’s. Rate-limited with its own budget. 409 at the per-user ' +
      'file cap; 503 `STORAGE_UNAVAILABLE` when the server has no bucket configured.',
    bearer: true,
    body: uploadRequestSchema,
    responses: {
      '201': { description: 'The signed upload', schema: uploadResponseSchema },
      '400': validationFailed,
      '404': notYours('project'),
      '409': error('LIMIT_REACHED: the user holds the maximum number of files'),
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
  {
    method: 'get',
    path: '/v1/projects/{id}/team',
    operationId: 'listProjectTeam',
    tag: 'team',
    summary: 'Every membership of the caller’s project',
    description:
      'The owner’s management view: pending, accepted and rejected rows. Accepted members ' +
      'also appear on `ProjectDetail.team`. Owner only: anyone else, an accepted teammate ' +
      'included, gets the 404 of an unknown project.',
    bearer: true,
    params: projectTeamParamSchema,
    responses: {
      '200': { description: 'The team', schema: teamListSchema },
      '404': notYours('project'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'get',
    path: '/v1/users/lookup',
    operationId: 'lookupUsers',
    tag: 'team',
    summary: 'People to invite: public profiles by the start of a name',
    description:
      'Prefix match on the name, at least 3 characters, at most 8 results, never the caller, ' +
      'never a private profile, never an email or other private field. Own rate budget ' +
      '(`RATE_LIMIT_LOOKUP`) against enumeration.',
    bearer: true,
    query: lookupQuerySchema,
    responses: {
      '200': { description: 'Up to 8 people', schema: lookupResultSchema },
      '400': error('VALIDATION_FAILED: `q` is missing or shorter than 3 characters'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'post',
    path: '/v1/projects/{id}/team',
    operationId: 'inviteTeamMember',
    tag: 'team',
    summary: 'Invites a user to the project',
    description:
      'Owner only. The invitee is notified in the same transaction. A user who rejected ' +
      'earlier is invited again (their row goes back to `pending`). Inviting yourself is ' +
      '400; a private profile and an unknown id are the same 404.',
    bearer: true,
    params: projectTeamParamSchema,
    body: inviteMemberSchema,
    responses: {
      '201': { description: 'The pending membership', schema: teamMemberSchema },
      '400': validationFailed,
      '404': error('NOT_FOUND: no such project of the caller’s, or no such public user'),
      '409': error(
        'ALREADY_MEMBER: already pending or accepted; TEAM_FULL: PROJECT_MAX_TEAM rows; PROJECT_IS_DRAFT: a draft takes no invitations',
      ),
      ...authenticatedFailures,
    },
  },
  {
    method: 'post',
    path: '/v1/projects/{id}/team/external',
    operationId: 'addExternalTeamMember',
    tag: 'team',
    summary: 'Adds a teammate who has no account',
    description:
      'Owner only. A name (and role) only: accepted at once, no invitation, no notification.',
    bearer: true,
    params: projectTeamParamSchema,
    body: addExternalMemberSchema,
    responses: {
      '201': { description: 'The accepted membership', schema: teamMemberSchema },
      '400': validationFailed,
      '404': notYours('project'),
      '409': error('TEAM_FULL: PROJECT_MAX_TEAM rows'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'delete',
    path: '/v1/projects/{id}/team/{memberId}',
    operationId: 'removeTeamMember',
    tag: 'team',
    summary: 'Removes a membership of the project',
    description:
      'Owner only. Any status, linked or external. Removing a pending invitation makes the ' +
      'invitee’s notification read `invite.status: gone`.',
    bearer: true,
    params: memberParamsSchema,
    responses: {
      '204': { description: 'Removed' },
      '404': error('NOT_FOUND: no such project of the caller’s, or no such member of it'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'post',
    path: '/v1/projects/{id}/team/me/accept',
    operationId: 'acceptTeamInvitation',
    tag: 'team',
    summary: 'The invitee accepts',
    description:
      'Only the invited user, only while `pending`. The owner is notified in the same ' +
      'transaction. No invitation for the caller (or an unknown project) is 404.',
    bearer: true,
    params: projectTeamParamSchema,
    responses: {
      '200': { description: 'The accepted membership', schema: teamMemberSchema },
      '404': error('NOT_FOUND: no such project, or no invitation for the caller'),
      '409': error('INVITE_NOT_PENDING: already answered'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'post',
    path: '/v1/projects/{id}/team/me/reject',
    operationId: 'rejectTeamInvitation',
    tag: 'team',
    summary: 'The invitee declines',
    description: 'As accept. The owner may invite the user again afterwards.',
    bearer: true,
    params: projectTeamParamSchema,
    responses: {
      '200': { description: 'The rejected membership', schema: teamMemberSchema },
      '404': error('NOT_FOUND: no such project, or no invitation for the caller'),
      '409': error('INVITE_NOT_PENDING: already answered'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'delete',
    path: '/v1/projects/{id}/team/me',
    operationId: 'leaveProjectTeam',
    tag: 'team',
    summary: 'An accepted teammate leaves',
    description:
      'Removes the caller’s own accepted membership; the owner is notified (`team_left`). ' +
      'A pending invitee uses reject. Anyone else is 404.',
    bearer: true,
    params: projectTeamParamSchema,
    responses: {
      '204': { description: 'Left' },
      '404': error('NOT_FOUND: no such project, or the caller is not an accepted member'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'get',
    path: '/v1/me/activities',
    operationId: 'listMyActivities',
    tag: 'activities',
    summary: 'The caller’s activity feed, newest first',
    description:
      'The dashboard feed: project and profile events written in the same transaction as ' +
      'the event. Each item is a `translationKey` and `translationParams`; the frontend ' +
      'renders the text. Only the caller’s own feed exists, so there is no id to ask for. ' +
      'Keyset pagination: pass `nextCursor` back as `cursor`.',
    bearer: true,
    query: activityQuerySchema,
    responses: {
      '200': { description: 'One page', schema: activityPageSchema },
      '400': error('VALIDATION_FAILED: a query parameter is invalid (see `details`)'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'get',
    path: '/v1/me/notifications',
    operationId: 'listMyNotifications',
    tag: 'notifications',
    summary: 'The caller’s notifications, newest first',
    description:
      'Keyset pagination: pass `nextCursor` back as `cursor`. Render the text from `type` ' +
      'and `params` in the reader’s language; `link` and `invite` are computed at read time.',
    bearer: true,
    query: notificationQuerySchema,
    responses: {
      '200': { description: 'One page', schema: notificationPageSchema },
      '400': error('VALIDATION_FAILED: a query parameter is invalid (see `details`)'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'get',
    path: '/v1/me/notifications/unread-count',
    operationId: 'getUnreadNotificationCount',
    tag: 'notifications',
    summary: 'How many of the caller’s notifications are unread',
    description: 'Cheap enough to poll (the frontend polls it about once a minute).',
    bearer: true,
    responses: {
      '200': { description: 'The count', schema: unreadCountSchema },
      ...authenticatedFailures,
    },
  },
  {
    method: 'post',
    path: '/v1/me/notifications/read-all',
    operationId: 'markAllNotificationsRead',
    tag: 'notifications',
    summary: 'Marks all of the caller’s notifications read',
    bearer: true,
    responses: {
      '200': { description: 'How many were unread', schema: readAllResultSchema },
      ...authenticatedFailures,
    },
  },
  {
    method: 'post',
    path: '/v1/me/notifications/{id}/read',
    operationId: 'markNotificationRead',
    tag: 'notifications',
    summary: 'Marks one notification read',
    description: 'Idempotent. Someone else’s notification answers 404, as an unknown id does.',
    bearer: true,
    params: notificationIdParamSchema,
    responses: {
      '204': { description: 'Marked (or already read)' },
      '404': notYours('notification'),
      ...authenticatedFailures,
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
      { name: 'team', description: 'Project teams: invitations, answers, the owner’s view' },
      { name: 'notifications', description: 'The caller’s own notifications' },
      { name: 'activities', description: 'The caller’s own activity feed' },
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
