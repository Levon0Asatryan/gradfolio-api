import { z, type ZodObject, type ZodType } from 'zod';
import { resumeRequestSchema } from '../resume/resume.dto.js';
import {
  emailPreferencesSchema,
  emailPreferencesPatchSchema,
  unsubscribeSchema,
  unsubscribeResultSchema,
} from '../email/email.dto.js';
import { LIVENESS_PATH, READINESS_PATH } from '../health/constants.js';
import { meResponseSchema } from '../me/dto/me.dto.js';
import {
  attachmentParamsSchema,
  createAttachmentSchema,
  patchAttachmentSchema,
} from '../projects/dto/attachment.dto.js';
import { activityPageSchema, activityQuerySchema } from '../activities/dto/activity.dto.js';
import { dashboardSchema } from '../dashboard/dto/dashboard.dto.js';
import {
  githubImportRequestSchema,
  githubImportResponseSchema,
  githubPreviewRequestSchema,
  githubPreviewResponseSchema,
  githubRepoPageSchema,
  githubReposQuerySchema,
  githubSyncQuerySchema,
  githubSyncResponseSchema,
} from '../integrations/dto/github-import.dto.js';
import {
  connectResponseSchema,
  disconnectResponseSchema,
  integrationsResponseSchema,
  linkRequestSchema,
  linkResponseSchema,
} from '../integrations/dto/integration.dto.js';
import {
  linkedinConfirmRequestSchema,
  linkedinConfirmResponseSchema,
  linkedinPreviewRequestSchema,
  linkedinPreviewResponseSchema,
  linkedinUploadRequestSchema,
  linkedinUploadResponseSchema,
} from '../integrations/dto/linkedin-import.dto.js';
import {
  browseProjectsQuerySchema,
  browseUsersQuerySchema,
  discoveryProjectPageSchema,
  personPageSchema,
  searchPageQuerySchema,
  searchQuerySchema,
  searchResultsSchema,
  suggestionsQuerySchema,
  suggestionsSchema,
  tagPageQuerySchema,
  tagQuerySchema,
  tagCloudQuerySchema,
  tagCloudSchema,
  tagSummarySchema,
  userFacetsSchema,
} from '../discovery/dto/discovery.dto.js';
import {
  notificationIdParamSchema,
  notificationPageSchema,
  notificationQuerySchema,
  readAllResultSchema,
  unreadCountSchema,
} from '../notifications/dto/notification.dto.js';
import { myTeamsQuerySchema, myTeamsSchema } from '../team/dto/my-teams.dto.js';
import {
  acceptBodySchema,
  refreshResponseSchema,
  resolveResponseSchema,
  suggestionIdParamSchema,
  suggestionPageSchema,
  suggestionQuerySchema,
} from '../suggestions/dto/suggestion.dto.js';
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
  /** The body may be left out (a request without one is valid). */
  bodyOptional?: boolean;
  responses: Record<string, { description: string; schema?: ZodType; contentType?: string }>;
  /** Needs `Authorization: Bearer <Auth0 access token>`. Every route except `@Public()` ones. */
  bearer?: boolean;
  /**
   * A contract published before its route exists: the pull request that will
   * serve it. Rendered with `x-gradfolio-planned` and a "not served yet" note;
   * document.test.ts checks that no planned operation is served, so the flag
   * is removed in the same change that adds the route.
   */
  planned?: string;
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

/** Public search and tag pages: no token needed, results are the same for everyone (docs/modules/m6/plan.md). */
function discoveryOperations(): Operation[] {
  const base = { tag: 'discovery' } as const;
  const failures = {
    '400': error('VALIDATION_FAILED: a query parameter is invalid (see `details`)'),
    '401': error('UNAUTHENTICATED: a token was sent and is invalid or expired'),
    '429': error('RATE_LIMITED: over budget; see the Retry-After header'),
    '503': error('AUTH_UNAVAILABLE or DATABASE_UNAVAILABLE'),
  };
  const visibility =
    'Only published projects of public profiles, and public profiles: private and draft ' +
    'work never appears, **for anyone, the owner included** (use `/v1/me/projects` for your own). ' +
    'Needs no token; one that is sent is verified and only changes whose rate budget is used.';
  return [
    {
      ...base,
      method: 'get',
      path: '/v1/search',
      operationId: 'search',
      summary: 'Search people and projects',
      description:
        `${visibility} Each group is the best few matches, in relevance order, with \`hasMore\`; ` +
        'page one group with `/v1/search/people` or `/v1/search/projects`. Words of two ' +
        'characters or fewer (`AI`, `ML`, `Go`), and `C#`-style words, match whole skills, ' +
        'technologies and tags exactly and the start of words in names and titles. Common ' +
        'English words (`the`, `an`) are ignored when other words remain.',
      query: searchQuerySchema,
      responses: {
        '200': { description: 'The best matches', schema: searchResultsSchema },
        ...failures,
      },
    },
    {
      ...base,
      method: 'get',
      path: '/v1/search/suggestions',
      operationId: 'searchSuggestions',
      summary: 'Typeahead: a few people, projects and terms that start with the text',
      description:
        `${visibility} Matches the start of the text or of any word in it, so a single letter ` +
        'works; at most 5 of each. Tags are skills, technologies and tags that a public project or ' +
        'profile uses, in the site-wide spelling. Has its own, larger rate budget for debounced ' +
        'bursts. Use `/v1/search` for results.',
      query: suggestionsQuerySchema,
      responses: {
        '200': { description: 'The suggestions', schema: suggestionsSchema },
        ...failures,
      },
    },
    {
      ...base,
      method: 'get',
      path: '/v1/search/people',
      operationId: 'searchPeople',
      summary: 'Search people, paged',
      description:
        `${visibility} Order: relevance (name equals the query, then every word starts a word ` +
        'of the name, then headline or skill), then newest. Cursors are not signed: they only ' +
        'position the page.',
      query: searchPageQuerySchema,
      responses: { '200': { description: 'One page', schema: personPageSchema }, ...failures },
    },
    {
      ...base,
      method: 'get',
      path: '/v1/search/projects',
      operationId: 'searchProjects',
      summary: 'Search projects, paged',
      description:
        `${visibility} Order: relevance (title equals the query, then every word in the title ` +
        'or a technology/tag, then the summary), then newest. Cursors are not signed.',
      query: searchPageQuerySchema,
      responses: {
        '200': { description: 'One page', schema: discoveryProjectPageSchema },
        ...failures,
      },
    },
    {
      ...base,
      method: 'get',
      path: '/v1/tags',
      operationId: 'getTag',
      summary: 'A skill, technology or tag and how many public things use it',
      description:
        `${visibility} The name is matched case-insensitively and returned in the site-wide ` +
        'spelling. A name that no public project or profile uses is 404, the same answer for ' +
        'one that is only used privately.',
      query: tagQuerySchema,
      responses: {
        '200': { description: 'The term', schema: tagSummarySchema },
        '404': error('NOT_FOUND: no public project or profile uses this name'),
        ...failures,
      },
    },
    {
      ...base,
      method: 'get',
      path: '/v1/tags/projects',
      operationId: 'listTagProjects',
      summary: 'Projects that use a skill, technology or tag, newest first',
      description: `${visibility} A name nobody public uses is an empty page, not an error.`,
      query: tagPageQuerySchema,
      responses: {
        '200': { description: 'One page', schema: discoveryProjectPageSchema },
        ...failures,
      },
    },
    {
      ...base,
      method: 'get',
      path: '/v1/tags/people',
      operationId: 'listTagPeople',
      summary: 'People who list a skill, newest first',
      description: `${visibility} A name nobody public lists is an empty page, not an error.`,
      query: tagPageQuerySchema,
      responses: { '200': { description: 'One page', schema: personPageSchema }, ...failures },
    },
    {
      ...base,
      method: 'get',
      path: '/v1/tags/cloud',
      operationId: 'getTagCloud',
      summary: 'The most used skills, technologies and tags, with counts',
      description:
        `${visibility} Most used first (projects plus people), then by name. Served from a ` +
        'one-minute in-memory cache, so a change can take up to a minute (and a little more ' +
        'per server instance) to show: `generatedAt` says when the counts were computed.',
      query: tagCloudQuerySchema,
      responses: { '200': { description: 'The cloud', schema: tagCloudSchema }, ...failures },
    },
    {
      ...base,
      method: 'get',
      path: '/v1/projects',
      operationId: 'browseProjects',
      summary: 'Browse projects',
      description:
        `${visibility} Newest first by creation (\`sort=newest\`, the default) or by last ` +
        'change (`sort=updated`), optionally one `category` and/or `status`. Every order ends ' +
        'in the id, so pages never repeat or skip a row. Cursors are not signed.',
      query: browseProjectsQuerySchema,
      responses: {
        '200': { description: 'One page', schema: discoveryProjectPageSchema },
        ...failures,
      },
    },
    {
      ...base,
      method: 'get',
      path: '/v1/users',
      operationId: 'browseUsers',
      summary: 'Browse people',
      description:
        `${visibility} Newest sign-up first (\`sort=newest\`, the only order). \`school\`, ` +
        '`major` and `gradYear` filter on the education entries: one entry must match every ' +
        'filter given. Take the choices from `/v1/users/facets`.',
      query: browseUsersQuerySchema,
      responses: { '200': { description: 'One page', schema: personPageSchema }, ...failures },
    },
    {
      ...base,
      method: 'get',
      path: '/v1/users/facets',
      operationId: 'getUserFacets',
      summary: 'The school, major and graduation-year choices of the people directory',
      description:
        `${visibility} Values present on public profiles, most common first, at most 50 each; ` +
        'cached for a minute like the tag cloud.',
      responses: { '200': { description: 'The choices', schema: userFacetsSchema }, ...failures },
    },
  ];
}

/** The caller's integrations: GitHub connect (docs/modules/m7/plan.md §2.3, §7 items 1–4). */
function integrationOperations(): Operation[] {
  const base = { tag: 'integrations', bearer: true } as const;
  const unavailable = error(
    'INTEGRATION_UNAVAILABLE: GitHub connect is not configured on this server, or Auth0 could ' +
      'not be used (see Retry-After when it is a rate limit); AUTH_UNAVAILABLE or ' +
      'DATABASE_UNAVAILABLE as on every route',
  );
  // Each operation names its own 429 and 503.
  const { '401': unauthenticated } = authenticatedFailures;
  const failures = { '401': unauthenticated };
  const inProgress =
    'GITHUB_LINK_IN_PROGRESS: a link started moments ago is still running; ' +
    'GITHUB_STATE_CHANGED: GitHub was connected or disconnected by another request at the same ' +
    'moment (nothing was changed by this one; reload and retry)';
  return [
    {
      ...base,
      method: 'get',
      path: '/v1/me/integrations',
      operationId: 'getMyIntegrations',
      summary: 'The caller’s GitHub and LinkedIn status',
      description:
        'Only the caller’s own state; never a token, a nonce or the GitHub numeric id. GitHub is ' +
        '`connected` only once confirmed: a link still in progress reads `not_connected`. A link ' +
        'left half-done (the server stopped between Auth0 and our database) is settled here from ' +
        'Auth0’s record. LinkedIn is `connected` when the caller signs in with LinkedIn.',
      responses: {
        '200': { description: 'The integrations', schema: integrationsResponseSchema },
        '409': error('GITHUB_NOT_LINKED: settling a half-done link found the GitHub token refused'),
        '429': error(
          'RATE_LIMITED (over budget) or GITHUB_RATE_LIMITED; see the Retry-After header',
        ),
        '502': error('GITHUB_UNAVAILABLE: GitHub failed while a half-done link was settled'),
        ...failures,
        '503': unavailable,
      },
    },
    {
      ...base,
      method: 'post',
      path: '/v1/me/integrations/github/connect',
      operationId: 'connectGithub',
      summary: 'Connect GitHub, or get a nonce to link it',
      description:
        'When Auth0 already holds a GitHub identity for the caller (they sign in with GitHub, or ' +
        'linked it), GitHub confirms its token and the account is connected: `state: ' +
        'connected`. Otherwise `state: link_required` with a single-use nonce for a secondary ' +
        'GitHub sign-in (see `link`); so is the case where GitHub refuses the token Auth0 holds ' +
        '(revoked at GitHub, or stale), for any login: a flag left from that token is cleared ' +
        'first, and the sign-in replaces the token. `link` finishes it, including for a login ' +
        'that is itself the GitHub one. Public repositories only (D6). A connected GitHub ' +
        'counts toward `verified`.',
      responses: {
        '200': { description: 'Connected, or a link is required', schema: connectResponseSchema },
        '409': error(
          `GITHUB_ACCOUNT_IN_USE: another Gradfolio account has this GitHub account; ${inProgress}`,
        ),
        '429': error('RATE_LIMITED or GITHUB_RATE_LIMITED; see the Retry-After header'),
        '502': error('GITHUB_UNAVAILABLE: GitHub failed or timed out'),
        ...failures,
        '503': unavailable,
      },
    },
    {
      ...base,
      method: 'post',
      path: '/v1/me/integrations/github/link',
      operationId: 'linkGithub',
      summary: 'Link a GitHub sign-in to the caller’s account',
      description:
        'Send the `id_token` of the secondary GitHub sign-in started with the nonce from ' +
        '`connect`. It must be fresh (issued within 5 minutes), for this application, and carry ' +
        'that nonce, which works once. The GitHub account is reserved first, so no other ' +
        'account can take it, then Auth0 links it. When Auth0’s answer is lost, the reservation ' +
        'is settled later from Auth0’s record (`GET /v1/me/integrations`).',
      body: linkRequestSchema,
      responses: {
        '200': { description: 'Connected', schema: linkResponseSchema },
        '400': error(
          'INVALID_ID_TOKEN: the id token is not a valid, fresh GitHub sign-in for this ' +
            'application; INVALID_NONCE: the nonce is unknown, expired, used, or another ' +
            'user’s; VALIDATION_FAILED: the body',
        ),
        '409': error(
          'GITHUB_ACCOUNT_IN_USE: that GitHub account is a Gradfolio account of its own, or ' +
            'another account holds it; GITHUB_ALREADY_CONNECTED; GITHUB_LINK_REFUSED: Auth0 ' +
            `refused the link; ${inProgress}; GITHUB_NOT_LINKED: the token Auth0 holds after the ` +
            'sign-in is still refused by GitHub',
        ),
        '429': error('RATE_LIMITED or GITHUB_RATE_LIMITED; see the Retry-After header'),
        '502': error('GITHUB_UNAVAILABLE: GitHub failed while confirming the new link'),
        ...failures,
        '503': error(
          'INTEGRATION_UNAVAILABLE: not configured, or Auth0 failed (when its answer was lost the ' +
            'link is settled later); AUTH_UNAVAILABLE: the signing keys could not be fetched',
        ),
      },
    },
    {
      ...base,
      method: 'delete',
      path: '/v1/me/integrations/github',
      operationId: 'disconnectGithub',
      summary: 'Disconnect GitHub, revoking access at GitHub first',
      description:
        'Revokes the GitHub app grant first (every token of it, including the one Auth0 holds); ' +
        'only once GitHub confirms, or there is nothing left to revoke, is GitHub disconnected. ' +
        'A token GitHub itself refuses (`GET /user` answers 401) counts as revoked, whatever the ' +
        'grant delete answered: the API holds no other token, and GitHub deletes a grant only ' +
        'for a valid one. Any other authorization the student made at GitHub stays until they ' +
        'remove it under Settings, Applications. ' +
        'A revocation GitHub refuses changes nothing (502): retry. One whose outcome is unknown ' +
        '(timeout, dropped connection, 5xx) also answers 502, but the grant may still be deleted: ' +
        'the card then shows not_connected and a retry answers 409 GITHUB_LINK_IN_PROGRESS until ' +
        'it settles, after a short delay. Idempotent. Imported projects stay. ' +
        'The GitHub identity stays linked at Auth0 (a GitHub sign-in keeps working); ' +
        'reconnecting needs one fresh GitHub sign-in. `verified` falls back to the email.',
      responses: {
        '200': { description: 'Disconnected', schema: disconnectResponseSchema },
        '409': error(inProgress),
        '502': error(
          'GITHUB_REVOKE_FAILED: GitHub did not confirm the revocation. When GitHub refused, ' +
            'nothing changed. When it timed out, dropped the connection or answered 5xx, the ' +
            'grant may still be deleted: the card shows not_connected and a retry answers 409 ' +
            'GITHUB_LINK_IN_PROGRESS until the outcome settles, after a short delay; retry ' +
            'shortly, and the next request then shows the true state',
        ),
        ...failures,
        '503': unavailable,
      },
    },
  ];
}

/**
 * Suggestions (docs/modules/m7/plan.md §6): proposals from GitHub and the sign-in
 * claims that the caller accepts or dismisses. Nothing changes the profile
 * except an accept.
 */
function suggestionOperations(): Operation[] {
  const base = { tag: 'suggestions', bearer: true } as const;
  const resolved = error(
    'SUGGESTION_RESOLVED: it was already dismissed, superseded or accepted; ' +
      'SUGGESTION_INVALID: the value can no longer be written (it is superseded); ' +
      'SUGGESTION_STALE: the skill is already on the profile, the link field was filled since the offer, ' +
      'the project’s field was edited (or re-synced) since, or the repository is already imported, gone, or no longer your own public, non-fork, non-archived work (it is superseded); ' +
      'LIMIT_REACHED: a `project.new` would exceed the per-user project cap (it stays open)',
  );
  return [
    {
      ...base,
      method: 'get',
      path: '/v1/me/suggestions',
      operationId: 'listSuggestions',
      summary: 'The caller’s suggestions, newest first',
      description:
        'Open ones by default (`status=all` adds the answered). A `profile.*` suggestion names ' +
        'the `field`, what it holds now (`current`) and what an accept would write (`proposed`). ' +
        'A `profile.links.linkedin` / `profile.links.twitter` suggestion (from GitHub’s social ' +
        'accounts) is always `mode: fill`: offered to an empty field only. ' +
        'A `skill.add` suggestion names the `skill` and the `evidence` (public repositories and ' +
        'projects that show it). A `project.new` suggestion names the `repository` to import (and ' +
        '`project.id` once accepted). A `project.update` suggestion names the `project`, the ' +
        '`field` (`summary`: GitHub’s description; `descriptionHtml`: the README) and the ' +
        '`proposed` value; it is offered only while the project’s field is still what the import ' +
        'or last re-sync wrote. An `education.add` (the configured institution, UNIVERSITY_NAME) or ' +
        '`experience.add` (a configured organisation, UNIVERSITY_ORGS) names the section in `field` and ' +
        'the institution or organisation in `proposed`; accepting it needs `overrides`. ' +
        '`openCount` is the caller’s open suggestions in all.',
      query: suggestionQuerySchema,
      responses: {
        '200': { description: 'One page', schema: suggestionPageSchema },
        '400': validationFailed,
        ...authenticatedFailures,
      },
    },
    {
      ...base,
      method: 'post',
      path: '/v1/me/suggestions/refresh',
      operationId: 'refreshSuggestions',
      summary: 'Read GitHub’s public profile and recompute the suggestions',
      description:
        'Reads GitHub at most once per SUGGESTIONS_MIN_INTERVAL_S (conditionally by ETag; a ' +
        'refresh inside the floor uses the stored profile and says `throttled`), then opens ' +
        'what is new, supersedes what GitHub no longer says, and never reopens an answered ' +
        'suggestion with the same value. It also reads the caller’s newest public repositories ' +
        '(not forks): one `GET /user/repos` page and, for the newest SUGGESTIONS_LANGUAGE_REPOS ' +
        '(default 5), one `GET …/languages` each, and offers a skill missing from the profile ' +
        '(compared case-insensitively) that at least two repositories or projects show. A ' +
        'refresh inside the floor reads nothing and keeps the open skill suggestions. Repositories: ' +
        'up to SUGGESTIONS_NEW_REPOS (default 5) of the newest own, not-imported repositories are offered as ' +
        '`project.new`; for each imported project whose repository is on that page, a changed ' +
        'description is offered as `project.update` at no extra call, and its README is read (one call each, ' +
        'at most SUGGESTIONS_README_READS, default 10) only if the repository was pushed to since the import or ' +
        'last re-sync. Stars and forks are never suggested. One notification (`suggestions_available`, ' +
        '`count` and `kinds`) is written when a refresh opens repository suggestions, in the same transaction. LinkedIn: a sign-in’s name and photo, and a re-import ' +
        'reminder. University: when UNIVERSITY_DOMAINS is set, one `GET /user/emails` (a verified ' +
        'address on a listed domain or a subdomain of it offers the institution as `education.add`; ' +
        'an unverified one counts for nothing; an address is compared and dropped, never stored, ' +
        'returned or logged); when UNIVERSITY_ORGS is set, `GET /user` and `GET /users/{login}/orgs` ' +
        '(a listed public organisation is offered as `experience.add`). Offered only when the ' +
        'profile has no entry for that institution or organisation. Without GitHub connected the LinkedIn rules run and skills are offered from the caller’s projects alone.',
      responses: {
        '200': { description: 'What was done', schema: refreshResponseSchema },
        '409': error('GITHUB_NOT_LINKED: GitHub refused the token (sign in with GitHub again)'),
        '429': error('RATE_LIMITED (the `import` budget) or GITHUB_RATE_LIMITED; see Retry-After'),
        '502': error('GITHUB_UNAVAILABLE: GitHub failed or timed out'),
        '401': authenticatedFailures['401'],
        '503': error('INTEGRATION_UNAVAILABLE, AUTH_UNAVAILABLE or DATABASE_UNAVAILABLE'),
      },
    },
    {
      ...base,
      method: 'post',
      path: '/v1/me/suggestions/{id}/accept',
      operationId: 'acceptSuggestion',
      summary: 'Apply a suggestion: write the one field it names',
      description:
        'Writes that field through the profile’s own rules and marks the suggestion accepted, in ' +
        'one transaction. A `skill.add` appends the skill to the profile’s skills (at most ' +
        'PROFILE_MAX_SKILLS, else 400). A `project.new` imports the repository as a draft through ' +
        'the import service (GitHub is read again; the repository must still be the caller’s own public, ' +
        'non-fork, non-archived work, else 409 `SUGGESTION_STALE` and no draft) and answers with its `projectId`. A ' +
        '`project.update` writes the field only if it still equals the snapshot of the last import, ' +
        're-sync or accept, and moves the snapshot; a field the student changed is never overwritten: ' +
        '409 `SUGGESTION_STALE`. An `education.add` or `experience.add` adds the entry through the ' +
        'section’s create rules: `overrides` gives `degree`, `field`, `startYear` (education) or ' +
        '`title`, `start` (experience); a missing or invalid one is a 400 naming `overrides.<field>` ' +
        'and the suggestion stays open; if the profile has an entry for that name by now, or the ' +
        'configuration no longer offers it, 409 `SUGGESTION_STALE`. Other kinds take no overrides. ' +
        'Idempotent for an accepted one. A reminder is only acknowledged.',
      params: suggestionIdParamSchema,
      body: acceptBodySchema,
      bodyOptional: true,
      responses: {
        '200': { description: 'Accepted', schema: resolveResponseSchema },
        '400': validationFailed,
        '404': notYours('suggestion'),
        '409': resolved,
        '502': error('GITHUB_UNAVAILABLE: a `project.new` could not read GitHub'),
        ...authenticatedFailures,
      },
    },
    {
      ...base,
      method: 'post',
      path: '/v1/me/suggestions/{id}/dismiss',
      operationId: 'dismissSuggestion',
      summary: 'Dismiss a suggestion; it is not offered again until the value changes',
      description:
        'Remembered by its key, which carries a hash of the proposed value: GitHub saying ' +
        'something else is a new suggestion. Idempotent for a dismissed one.',
      params: suggestionIdParamSchema,
      responses: {
        '200': { description: 'Dismissed', schema: resolveResponseSchema },
        '404': notYours('suggestion'),
        '409': resolved,
        ...authenticatedFailures,
      },
    },
  ];
}

/**
 * GitHub import and the LinkedIn export import (docs/modules/m7/plan.md §3, §4; §7
 * items 5–10): the contract, published with PR (a) so the frontend can build
 * against it. Those of PR (c) are still `planned`; the PR that serves one
 * drops the flag.
 */
function plannedImportOperations(): Operation[] {
  const base = { tag: 'integrations', bearer: true } as const;
  const github = {
    '409': error(
      'GITHUB_NOT_CONNECTED: connect GitHub first; GITHUB_NOT_LINKED: GitHub refused the token ' +
        '(sign in with GitHub again)',
    ),
    '429': error('RATE_LIMITED or GITHUB_RATE_LIMITED; see the Retry-After header'),
    '502': error('GITHUB_UNAVAILABLE: GitHub failed or timed out'),
    '401': authenticatedFailures['401'],
    '503': error('INTEGRATION_UNAVAILABLE, AUTH_UNAVAILABLE or DATABASE_UNAVAILABLE'),
  };
  const importFailures = {
    '401': authenticatedFailures['401'],
    '429': error('RATE_LIMITED: over the `import` budget (5 per minute); see Retry-After'),
    '503': error(
      'STORAGE_UNAVAILABLE: uploads are off on this server; AUTH_UNAVAILABLE or ' +
        'DATABASE_UNAVAILABLE',
    ),
  };
  return [
    {
      ...base,
      method: 'get',
      path: '/v1/me/github/repos',
      operationId: 'listGithubRepos',
      summary: 'The caller’s public GitHub repositories, paged',
      description:
        'Owned and collaborator repositories, public only (D6), most recently pushed first. ' +
        '`q` searches name, description and language over up to GITHUB_SEARCH_SCAN_PAGES pages. ' +
        '`imported` and `projectId` say which the caller already imported. GitHub’s remaining ' +
        'rate limit is in `rateLimit`.',
      query: githubReposQuerySchema,
      responses: {
        '200': { description: 'One page', schema: githubRepoPageSchema },
        '400': validationFailed,
        ...github,
      },
    },
    {
      ...base,
      method: 'post',
      path: '/v1/me/github/import',
      operationId: 'importGithubRepos',
      summary: 'Import repositories as draft projects',
      description:
        'Each repository is read again from GitHub (stars, forks, language, README; the client’s ' +
        'numbers are never trusted) and imported only when the caller owns it or may push to it. ' +
        'Drafts: visible to the caller only until published. Deduplicated by repository id, also ' +
        'under concurrent imports. The README becomes the description, sanitized, images dropped ' +
        '(D3). `overrides` (per repository id) are what the student edited in the review step: ' +
        'title, summary, description, technologies, links, validated like a manual create ' +
        '(a bad one is a 400 naming `overrides.<id>.<field>` and nothing is created). They ' +
        'cannot set the source, the repository facts or the visibility, and the re-sync ' +
        'snapshot records what GitHub gave, so a later re-sync keeps them.',
      body: githubImportRequestSchema,
      responses: {
        '200': { description: 'One result per repository', schema: githubImportResponseSchema },
        '400': validationFailed,
        ...github,
        '429': error('RATE_LIMITED (the `import` budget) or GITHUB_RATE_LIMITED; see Retry-After'),
      },
    },
    {
      ...base,
      method: 'post',
      path: '/v1/me/github/import/preview',
      operationId: 'previewGithubImport',
      summary: 'The drafts an import would create, for the review step; saves nothing',
      description:
        'Read from GitHub exactly as the import does (ownership, README sanitized, the project ' +
        'create rules). `draft` is what the student may edit; `exists` and `skipped` say why a ' +
        'repository has none. The save re-reads GitHub: this answer is never trusted back.',
      body: githubPreviewRequestSchema,
      responses: {
        '200': { description: 'One result per repository', schema: githubPreviewResponseSchema },
        '400': validationFailed,
        ...github,
        '429': error('RATE_LIMITED (the `import` budget) or GITHUB_RATE_LIMITED; see Retry-After'),
      },
    },
    {
      ...base,
      method: 'post',
      path: '/v1/me/projects/{id}/github/sync',
      operationId: 'syncGithubProject',
      summary: 'Re-sync an imported project from GitHub, never overwriting an edit',
      description:
        'Per field: a value the caller edited is kept; one GitHub changed and the caller did not ' +
        'is updated; both changed is a `conflict` (kept, GitHub’s value reported). Stars, forks, ' +
        'language and README link always refresh (D8). `dryRun=true` reports without changing.',
      params: projectIdParamSchema,
      query: githubSyncQuerySchema,
      responses: {
        '200': { description: 'What changed, field by field', schema: githubSyncResponseSchema },
        '400': validationFailed,
        '404': notYours('project'),
        ...github,
        '409': error(
          'NOT_GITHUB_PROJECT: the project was not imported; GITHUB_REPO_UNAVAILABLE: the repository ' +
            'is gone or no longer visible; GITHUB_NOT_CONNECTED; GITHUB_NOT_LINKED',
        ),
        '429': error('RATE_LIMITED (the `import` budget) or GITHUB_RATE_LIMITED; see Retry-After'),
      },
    },
    {
      ...base,
      planned: 'M7 PR (c)',
      method: 'post',
      path: '/v1/me/imports/linkedin/uploads',
      operationId: 'createLinkedinUpload',
      summary: 'Get a signed URL to upload a LinkedIn data export ZIP',
      description:
        'The browser PUTs the ZIP straight to the returned URL (never through the frontend’s ' +
        'server: its body limit is 4.5 MB). At most IMPORT_MAX_PENDING uploads wait at once.',
      body: linkedinUploadRequestSchema,
      responses: {
        '201': { description: 'The upload ticket', schema: linkedinUploadResponseSchema },
        '400': validationFailed,
        '409': error('LIMIT_REACHED: too many uploads waiting for a preview'),
        '413': error('IMPORT_TOO_LARGE: over IMPORT_MAX_ZIP_BYTES'),
        ...importFailures,
      },
    },
    {
      ...base,
      planned: 'M7 PR (c)',
      method: 'post',
      path: '/v1/me/imports/linkedin/preview',
      operationId: 'previewLinkedinImport',
      summary: 'Read an uploaded export and propose entries; saves nothing',
      description:
        'Parses positions, education, skills and certifications; each item is `new`, ' +
        '`duplicate` (already on the profile) or `invalid` (with `problems`). The upload is ' +
        'deleted afterwards, whatever the outcome. Only the four datasets are ever opened.',
      body: linkedinPreviewRequestSchema,
      responses: {
        '200': { description: 'The proposal', schema: linkedinPreviewResponseSchema },
        '400': validationFailed,
        '404': error('IMPORT_UPLOAD_MISSING: no such upload of the caller’s'),
        '413': error('IMPORT_TOO_LARGE'),
        '422': error(
          'IMPORT_NOT_ZIP, IMPORT_TOO_MANY_ENTRIES, IMPORT_UNCOMPRESSED_TOO_LARGE, ' +
            'IMPORT_RATIO_EXCEEDED, IMPORT_UNSAFE_PATH, IMPORT_ENCRYPTED, IMPORT_ENTRY_NOT_CSV, ' +
            'IMPORT_EMPTY, IMPORT_COLUMNS_MISSING (see `details`), IMPORT_MALFORMED_CSV',
        ),
        ...importFailures,
        '429': error('RATE_LIMITED, or IMPORT_BUSY: too many previews running; see Retry-After'),
      },
    },
    {
      ...base,
      planned: 'M7 PR (c)',
      method: 'post',
      path: '/v1/me/imports/linkedin/confirm',
      operationId: 'confirmLinkedinImport',
      summary: 'Save the selected entries, in one transaction',
      description:
        'The items are validated again like manual entries. Entries equal to an existing one ' +
        'are skipped; skills merge case-insensitively. Over a section cap nothing is saved. A ' +
        'second identical confirm adds nothing.',
      body: linkedinConfirmRequestSchema,
      responses: {
        '200': { description: 'Counts per section', schema: linkedinConfirmResponseSchema },
        '400': validationFailed,
        '409': error('LIMIT_REACHED: a section would exceed its cap; nothing was saved'),
        ...importFailures,
      },
    },
  ];
}

export const OPERATIONS: readonly Operation[] = [
  {
    method: 'get',
    path: '/v1/me/email-preferences',
    operationId: 'getEmailPreferences',
    tag: 'email',
    bearer: true,
    summary: 'Read your invitation email preference and language',
    responses: {
      '200': { description: 'Your preferences', schema: emailPreferencesSchema },
      '404': notYours('account'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'patch',
    path: '/v1/me/email-preferences',
    operationId: 'updateEmailPreferences',
    tag: 'email',
    bearer: true,
    summary: 'Change your invitation email preference and language',
    body: emailPreferencesPatchSchema,
    responses: {
      '200': { description: 'Saved preferences', schema: emailPreferencesSchema },
      '400': validationFailed,
      '404': notYours('account'),
      ...authenticatedFailures,
    },
  },
  {
    method: 'post',
    path: '/v1/email/unsubscribe',
    operationId: 'unsubscribeInvitationEmail',
    tag: 'email',
    summary: 'Disable invitation email with the signed link from an email',
    body: unsubscribeSchema,
    responses: {
      '200': {
        description: 'Unsubscribed, also for a replay or a deleted account',
        schema: unsubscribeResultSchema,
      },
      '400': error('INVALID_UNSUBSCRIBE_TOKEN or VALIDATION_FAILED'),
      '429': authenticatedFailures['429'],
      '503': error('EMAIL_UNAVAILABLE'),
    },
  },
  {
    method: 'post',
    path: '/v1/me/resume',
    operationId: 'generateResume',
    tag: 'resume',
    summary: 'Download a resume PDF from selected sections of your profile',
    bearer: true,
    description:
      'Private/draft own projects require explicit IDs and includePrivateProjects. Accepted-team projects must be public and published. Login email and internal fields are never included. Dedicated PDF budget; no stored copy.',
    body: resumeRequestSchema,
    responses: {
      '200': {
        description: 'Resume download; private, no-store',
        schema: z.string().meta({ format: 'binary' }),
        contentType: 'application/pdf',
      },
      '400': validationFailed,
      '404': notYours('profile or project'),
      '422': error('RESUME_TOO_LARGE: select less content'),
      ...authenticatedFailures,
    },
  },
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
      'claims (name, email, picture); later calls return the same id. `verified` is the ' +
      'token’s `email_verified`, or a connected GitHub account.',
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
      'Irreversible. A connected GitHub account is revoked at GitHub first; if GitHub does ' +
      'not confirm, nothing is deleted (502, retry). The Auth0 login is not deleted: sign the ' +
      'user out afterwards, because a token that is still valid creates a new, empty account ' +
      'on its next request.',
    bearer: true,
    responses: {
      '204': { description: 'Deleted' },
      '404': error('NOT_FOUND: the account no longer exists'),
      '409': error(
        'GITHUB_STATE_CHANGED: GitHub was connected at the same moment; nothing deleted, retry',
      ),
      '502': error('GITHUB_REVOKE_FAILED: GitHub did not confirm the revocation; nothing deleted'),
      ...authenticatedFailures,
      '503': error(
        'INTEGRATION_UNAVAILABLE: a connected GitHub cannot be revoked now (Auth0 unreachable, ' +
          'or GitHub connect not configured); AUTH_UNAVAILABLE or DATABASE_UNAVAILABLE',
      ),
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
      'jpeg, webp, gif; PDFs only as an attachment. `projectId` is optional for `hero` and ' +
      '`attachment` (omit it while the project is being created); when given it must be ' +
      'the caller’s (404 otherwise), and an `avatar` with one is 400. Rate-limited with its own budget. 409 at the per-user ' +
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
    path: '/v1/me/teams',
    operationId: 'getMyTeams',
    tag: 'team',
    summary: 'The caller’s teams in one call',
    description:
      'Four lists, each on its own cursor: `owned` (projects the caller owns that have members, ' +
      'with every member and status), `member` (projects the caller is an accepted member of, ' +
      'never a draft), `incoming` (invitations waiting for the caller: the project’s title and ' +
      'the inviter only) and `outgoing` (invitations the caller sent that are pending). ' +
      'Everything is the caller’s own; another user’s teams cannot be asked for. Leaving a team ' +
      'is `DELETE /v1/projects/{id}/team/me`. A fixed number of statements however many ' +
      'projects and members there are.',
    bearer: true,
    query: myTeamsQuerySchema,
    responses: {
      '200': { description: 'The four lists', schema: myTeamsSchema },
      '400': error('VALIDATION_FAILED: a query parameter is invalid (see `details`)'),
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
      'and `params` in the reader’s language; `link` and `invite` are computed at read time. ' +
      '`suggestions_available`: a refresh opened repository suggestions; `params` are `count` and ' +
      '`kinds`, and the list is `GET /v1/me/suggestions`.',
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
  {
    method: 'get',
    path: '/v1/me/dashboard',
    operationId: 'getDashboard',
    tag: 'me',
    summary: 'The caller’s dashboard',
    description:
      'Counts of the caller’s projects by state, the sum of stored GitHub stars (null until an ' +
      'import stores any), the three most recently changed projects (own, plus non-draft ones ' +
      'they are an accepted member of), the number of feed entries in the last 30 days and the ' +
      'five newest feed entries, in one call. Only the caller’s own data. Render the feed from ' +
      '`translationKey` and `translationParams`.',
    bearer: true,
    responses: {
      '200': { description: 'The dashboard', schema: dashboardSchema },
      ...authenticatedFailures,
    },
  },
  ...discoveryOperations(),
  ...integrationOperations(),
  ...plannedImportOperations(),
  ...suggestionOperations(),
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
                [r.contentType ?? 'application/json']: {
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

    const description = op.planned
      ? `**Not served yet: arrives with ${op.planned}.** ${op.description ?? ''}`.trim()
      : op.description;
    paths[op.path] ??= {};
    paths[op.path]![op.method] = {
      operationId: op.operationId,
      tags: [op.tag],
      summary: op.summary,
      ...(description ? { description } : {}),
      ...(op.planned ? { 'x-gradfolio-planned': op.planned } : {}),
      ...(op.bearer ? { security: [{ bearerAuth: [] }] } : {}),
      ...(op.params || op.query
        ? { parameters: [...pathParameters(op, components), ...queryParameters(op, components)] }
        : {}),
      ...(op.body
        ? {
            requestBody: {
              required: op.bodyOptional !== true,
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
        '(`GET /v1/users/{id}`), a public project, and search and tag pages (`discovery`). ' +
        'Every failure answers with ' +
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
      {
        name: 'integrations',
        description: 'The caller’s GitHub and LinkedIn connections and imports',
      },
      {
        name: 'suggestions',
        description: 'What GitHub and the sign-in claims suggest for the caller’s profile',
      },
      {
        name: 'discovery',
        description: 'Public search and tag pages: published work of public profiles only',
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
