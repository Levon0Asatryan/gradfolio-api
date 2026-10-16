import { z } from 'zod';

/** `"true"` / `"false"` from the environment, to a boolean. Anything else fails at boot. */
function envBoolean(defaultValue: 'true' | 'false') {
  return z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((v) => v === 'true');
}

/**
 * A byte size with an explicit unit: `512kb`, `1mb`.
 *
 * Validated here rather than handed to body-parser, whose parser is lenient in
 * ways that turn a typo into a silent misconfiguration: `64kbb` becomes 64
 * bytes and `abc` becomes no limit at all. A bad value must stop the process
 * at boot, not quietly remove the cap.
 */
const BYTE_SIZE = /^([1-9]\d*)(kb|mb)$/;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function parseByteSize(value: string): number | undefined {
  const match = BYTE_SIZE.exec(value);
  if (!match) return undefined;
  const [, amount, unit] = match;
  return Number(amount) * (unit === 'mb' ? 1024 * 1024 : 1024);
}

/** How the process presents itself and what it logs. */
const runtime = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // `pretty` needs pino-pretty, a devDependency: it is for a human at a
  // terminal running `npm run dev`. Its own switch rather than inferred from
  // NODE_ENV, so a container can run in development mode without a module the
  // runtime image does not ship.
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
};

/**
 * `false`, or how many proxies to believe. The hop count takes the address the
 * last trusted proxy appended, which a client cannot forge.
 */
const trustProxy = z
  .string()
  .default('false')
  .refine((v) => v !== 'true', {
    message: 'must be "false" or a hop count such as "1"; "true" trusts a client-written header',
  })
  // `true` has its own message above.
  .refine((v) => v === 'true' || v === 'false' || /^([1-9]|10)$/.test(v), {
    message: 'must be "false" or a hop count from 1 to 10',
  })
  .transform((v): false | number => (v === 'false' ? false : Number(v)));

/** HTTP server. */
const api = {
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // Project descriptions are rich HTML, the largest thing a client sends.
  // Attachments are URLs, not uploads, so nothing legitimate needs more.
  API_BODY_LIMIT: z
    .string()
    .default('256kb')
    .refine((v) => parseByteSize(v) !== undefined, {
      message: 'must be a positive byte size with an explicit unit, such as "256kb"',
    })
    .refine((v) => (parseByteSize(v) ?? 0) <= MAX_BODY_BYTES, {
      message: 'must not exceed 8mb',
    }),

  // Swagger UI at /docs. Off by default, like every switch that widens what is
  // reachable: it is a large piece of third-party browser code, and it exists
  // for people building against the API. docker compose turns it on.
  API_DOCS_ENABLED: envBoolean('false'),

  // How many proxies in front of the api may be believed about the client's
  // address: `false` (none) or a hop count. Not `true`: Express would then take
  // the left-most X-Forwarded-For entry, which the client itself writes (run:
  // `6.6.6.6, 203.0.113.9` -> 6.6.6.6), and the rate limiter keys on it.
  TRUST_PROXY: trustProxy,

  // Bounds the readiness check's response, not the query itself.
  HEALTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(3000),
};

/**
 * The Auth0 tenant's issuer: an origin, nothing after it. Normalized to exactly
 * one trailing slash, because that is the `iss` Auth0 writes and jose compares
 * `iss` exactly (run: a token whose `iss` lacks the slash is refused).
 */
const issuerBaseUrl = z
  .url()
  .refine(
    (v) => {
      const u = URL.parse(v);
      return (
        u !== null &&
        (u.protocol === 'https:' || u.protocol === 'http:') &&
        u.pathname === '/' &&
        u.search === '' &&
        u.hash === '' &&
        u.username === '' &&
        u.password === ''
      );
    },
    { message: 'must be an http(s) origin such as "https://tenant.eu.auth0.com/"' },
  )
  .transform((v) => `${new URL(v).origin}/`);

/** Verifying Auth0 access tokens (docs/m2-plan.md §3.2). */
const auth = {
  AUTH0_ISSUER_BASE_URL: issuerBaseUrl,
  // The Auth0 API identifier. Any non-empty string; not fetched.
  AUTH0_AUDIENCE: z.string().trim().min(1),
  // Bounds fetching the key set. An outage answers 503 after this long.
  AUTH0_JWKS_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(3000),
  // Accepted skew between Auth0's clock and ours, for `exp` and `nbf`.
  AUTH0_CLOCK_TOLERANCE_S: z.coerce.number().int().min(0).max(60).default(5),
};

/** Request budgets per window, per route, per client (docs/m2-plan.md §3.6). */
const rateLimit = {
  RATE_LIMIT_WINDOW_S: z.coerce.number().int().min(1).max(3600).default(60),
  // Every route.
  RATE_LIMIT_DEFAULT: z.coerce.number().int().min(1).max(100_000).default(120),
  // Only routes that opt in with @RateBudget: search (M6), import (M7), AI (M8).
  RATE_LIMIT_SEARCH: z.coerce.number().int().min(1).max(100_000).default(30),
  RATE_LIMIT_IMPORT: z.coerce.number().int().min(1).max(100_000).default(5),
  RATE_LIMIT_AI: z.coerce.number().int().min(1).max(100_000).default(10),
  RATE_LIMIT_LOOKUP: z.coerce.number().int().min(1).max(100_000).default(30),
  RATE_LIMIT_UPLOAD: z.coerce.number().int().min(1).max(100_000).default(20),
  // Browse, tag pages and the tag cloud (docs/m6-plan.md §9).
  RATE_LIMIT_BROWSE: z.coerce.number().int().min(1).max(100_000).default(60),
  // Typeahead: a debounced box sends a burst per keystroke pause, so this is the
  // largest per-route number, kept small by the cost of one suggestion (three
  // statements of at most 5 rows).
  RATE_LIMIT_SUGGEST: z.coerce.number().int().min(1).max(100_000).default(240),
  // Integrations status, connect, link, disconnect (docs/m7-plan.md §7).
  RATE_LIMIT_INTEGRATION: z.coerce.number().int().min(1).max(100_000).default(30),
  // The same budgets for an anonymous caller whose address is the frontend's
  // shared egress: no token and no valid forwarded-client-IP secret. Higher,
  // because every anonymous visitor then shares one counter (plan §2.4).
  RATE_LIMIT_DEFAULT_SHARED: z.coerce.number().int().min(1).max(1_000_000).default(600),
  RATE_LIMIT_SEARCH_SHARED: z.coerce.number().int().min(1).max(1_000_000).default(300),
  RATE_LIMIT_BROWSE_SHARED: z.coerce.number().int().min(1).max(1_000_000).default(600),
  RATE_LIMIT_SUGGEST_SHARED: z.coerce.number().int().min(1).max(1_000_000).default(2400),
  // Comma-separated, current first, previous second while rotating. When set,
  // a request carrying `X-Gradfolio-Proxy-Secret` equal to one of them may name
  // the real client in `X-Client-IP`. Unset: the header is ignored.
  PROXY_SHARED_SECRETS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .refine((list) => list.length <= 2 && list.every((s) => s.length >= 32 && s.length <= 256), {
      message: 'must be one or two secrets of 32 to 256 characters, comma-separated',
    }),
};

/** The caller's dashboard (docs/m6-plan.md §3.2). */
const dashboard = {
  // "Recent activity" counts the caller's activities in this many days.
  DASHBOARD_ACTIVITY_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // Projects and feed entries shown on the dashboard.
  DASHBOARD_RECENT_PROJECTS: z.coerce.number().int().min(1).max(20).default(3),
  DASHBOARD_FEED_SIZE: z.coerce.number().int().min(1).max(50).default(5),
};

/** Search, browse and tag pages (docs/m6-plan.md §3.1). */
const discovery = {
  // Items per page when `limit` is not given, and the most a caller may ask for.
  DISCOVERY_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(12),
  DISCOVERY_PAGE_MAX: z.coerce.number().int().min(1).max(100).default(30),
  // Items per group in the grouped `GET /v1/search` (no cursor there).
  SEARCH_GROUP_SIZE: z.coerce.number().int().min(1).max(30).default(6),
  // Suggestions per group (people, projects, tags) in the typeahead.
  SUGGEST_SIZE: z.coerce.number().int().min(1).max(10).default(5),
  // How long the tag cloud and the directory's filter choices are served from
  // memory (plan §3.4). 0 turns the cache off. Per process, so up to this long
  // stale, and not the same instant on each instance.
  DISCOVERY_CACHE_S: z.coerce.number().int().min(0).max(3600).default(60),
  // The most terms the cloud returns and the most choices per directory filter.
  TAG_CLOUD_MAX: z.coerce.number().int().min(1).max(200).default(100),
  TAG_CLOUD_SIZE: z.coerce.number().int().min(1).max(200).default(40),
  FACET_MAX: z.coerce.number().int().min(1).max(200).default(50),
};

/** Profile page bounds (docs/m3-plan.md §1, Limits). */
const profile = {
  // Projects listed on one profile (own and accepted-team together).
  // Education, experience and certification entries one user may hold, each.
  PROFILE_MAX_SECTION_ITEMS: z.coerce.number().int().min(1).max(500).default(50),
  // Skills one user may hold.
  PROFILE_MAX_SKILLS: z.coerce.number().int().min(1).max(1000).default(100),
  PROFILE_PROJECTS_LIMIT: z.coerce.number().int().min(1).max(500).default(50),
};

/** Project reads (docs/m4-plan.md §1, §5.2). */
const projects = {
  // Items per page when `limit` is not given, and the most a caller may ask for.
  PROJECTS_PAGE_SIZE: z.coerce.number().int().min(1).max(200).default(20),
  PROJECTS_PAGE_MAX: z.coerce.number().int().min(1).max(200).default(50),
  // What one user may hold or send: projects, tags/technologies/links per project,
  // and the description's size *after* sanitizing.
  PROJECT_MAX_PER_USER: z.coerce.number().int().min(1).max(1000).default(100),
  PROJECT_MAX_TAGS: z.coerce.number().int().min(1).max(100).default(20),
  PROJECT_MAX_TECHNOLOGIES: z.coerce.number().int().min(1).max(100).default(30),
  PROJECT_MAX_LINKS: z.coerce.number().int().min(1).max(100).default(10),
  PROJECT_DESCRIPTION_MAX_BYTES: z.coerce.number().int().min(1000).max(1_000_000).default(100_000),
  // Hosts a video attachment may point to (the parsed hostname, never a
  // substring). A host listed here is also one the code knows how to embed.
  ATTACHMENT_VIDEO_HOSTS: z
    .string()
    .default('youtube.com,www.youtube.com,m.youtube.com,youtu.be,vimeo.com,player.vimeo.com')
    .transform((v) =>
      v
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0),
    ),
};

/** File storage (docs/m4-plan.md §3). Unset STORAGE_BUCKET: URL-only, uploads answer 503. */
const storage = {
  STORAGE_BUCKET: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/, { message: 'must be a bucket name' })
    .optional(),
  // Sizes are checked against the *declared* size, which the signature then pins.
  UPLOAD_MAX_IMAGE_BYTES: z.coerce.number().int().min(1024).max(50_000_000).default(5_000_000),
  UPLOAD_MAX_PDF_BYTES: z.coerce.number().int().min(1024).max(100_000_000).default(20_000_000),
  // A signed upload URL's lifetime, and a signed read URL's (the window in which an
  // already-issued read URL outlives a project turning private; plan §2.2).
  UPLOAD_URL_TTL_S: z.coerce.number().int().min(30).max(3600).default(300),
  FILE_READ_URL_TTL_S: z.coerce.number().int().min(30).max(3600).default(300),
  // Objects one user may hold under their prefix (registered or not).
  UPLOAD_MAX_FILES_PER_USER: z.coerce.number().int().min(1).max(5000).default(200),
  PROJECT_MAX_ATTACHMENTS: z.coerce.number().int().min(1).max(200).default(20),
};

/** Teams and notifications (docs/m5-plan.md §1, §5.3). */
const notifications = {
  // Rows a project's team may hold, in any status: bounds what an owner (or a
  // pile of rejected invitations) can grow, checked under the project lock.
  PROJECT_MAX_TEAM: z.coerce.number().int().min(1).max(200).default(20),
  // Items per page when `limit` is not given, and the most a caller may ask for.
  NOTIFICATIONS_PAGE_SIZE: z.coerce.number().int().min(1).max(200).default(20),
  NOTIFICATIONS_PAGE_MAX: z.coerce.number().int().min(1).max(200).default(50),
  // The same for each list of `GET /me/teams` (a page loads its members in one query).
  TEAMS_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  TEAMS_PAGE_MAX: z.coerce.number().int().min(1).max(100).default(50),
  // The same for the activity feed.
  ACTIVITIES_PAGE_SIZE: z.coerce.number().int().min(1).max(200).default(20),
  ACTIVITIES_PAGE_MAX: z.coerce.number().int().min(1).max(200).default(50),
};

/** An optional, non-empty setting: unset (or blank) means the feature is off. */
const optionalSetting = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/**
 * GitHub's API base: an http(s) URL with no query, fragment or credentials,
 * normalized to end in `/` so paths resolve under it.
 */
const githubApiBaseUrl = z
  .url()
  .default('https://api.github.com/')
  .refine(
    (v) => {
      const u = URL.parse(v);
      return (
        u !== null &&
        (u.protocol === 'https:' || u.protocol === 'http:') &&
        u.search === '' &&
        u.hash === '' &&
        u.username === '' &&
        u.password === ''
      );
    },
    { message: 'must be an http(s) URL such as "https://api.github.com/"' },
  )
  .transform((v) => (v.endsWith('/') ? v : `${v}/`));

/**
 * GitHub connect (docs/m7-plan.md §2, §8). Every setting is optional: with any
 * of the five credentials unset, every GitHub route answers 503
 * INTEGRATION_UNAVAILABLE and production still boots.
 */
const integrations = {
  // The `Gradfolio` application's client id: the audience of the id token the
  // link flow forwards (plan §2.3). Not a secret.
  AUTH0_CLIENT_ID: optionalSetting(200),
  // The machine-to-machine application holding `read:user_idp_tokens` and
  // `update:users` on the Management API. The secret reads every user's GitHub
  // token: Secret Manager only.
  AUTH0_M2M_CLIENT_ID: optionalSetting(200),
  AUTH0_M2M_CLIENT_SECRET: optionalSetting(500),
  // Bounds one Management API call. A link still pending after twice this long
  // is settled from Auth0's record (plan §2.3).
  AUTH0_MANAGEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5000),
  // Spacing between Management API calls: the Free tenant allows 2 per second.
  AUTH0_MANAGEMENT_SPACING_MS: z.coerce.number().int().min(0).max(10_000).default(500),
  // The GitHub OAuth App behind Auth0's GitHub connection. Required (D9): only
  // its grant delete removes a token at GitHub, so without it nothing connects.
  GITHUB_CLIENT_ID: optionalSetting(200),
  GITHUB_CLIENT_SECRET: optionalSetting(500),
  GITHUB_API_BASE_URL: githubApiBaseUrl,
  GITHUB_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
  // How long a GitHub token read from Auth0 is kept in memory, and how many. 0
  // turns the cache off. Never persisted (D2).
  GITHUB_TOKEN_CACHE_S: z.coerce.number().int().min(0).max(900).default(300),
  GITHUB_TOKEN_CACHE_MAX: z.coerce.number().int().min(1).max(100_000).default(1000),
  // GitHub repository import (docs/m7-plan.md §3). Repositories per page the
  // caller may ask for; repositories one import may name; the most README bytes
  // read (over it the project is created without a description); and how many
  // repositories are read from GitHub at once.
  GITHUB_PAGE_MAX: z.coerce.number().int().min(1).max(100).default(30),
  GITHUB_IMPORT_MAX_BATCH: z.coerce.number().int().min(1).max(10).default(10),
  GITHUB_README_MAX_BYTES: z.coerce.number().int().min(1000).max(1_000_000).default(400_000),
  GITHUB_IMPORT_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(2),
  // A link nonce's lifetime, and the most an id token's `iat` may lie in the past.
  INTEGRATION_NONCE_TTL_S: z.coerce.number().int().min(60).max(3600).default(600),
  LINK_ID_TOKEN_MAX_AGE_S: z.coerce.number().int().min(30).max(3600).default(300),
};

/**
 * Suggestions (docs/m7-plan.md §6). The refresh floor per student, the open
 * suggestions one student may hold (the oldest are superseded), the list's
 * page sizes, and when LinkedIn's last export import counts as old. Mail
 * domains of universities, `domain=Institution`, comma-separated: empty until
 * Levon gives NPUA's (M7-T10); nothing uses it yet beyond parsing.
 */
const suggestions = {
  SUGGESTIONS_MIN_INTERVAL_S: z.coerce.number().int().min(0).max(86_400).default(900),
  SUGGESTIONS_MAX_OPEN: z.coerce.number().int().min(1).max(500).default(50),
  SUGGESTIONS_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  SUGGESTIONS_PAGE_MAX: z.coerce.number().int().min(1).max(100).default(50),
  LINKEDIN_REIMPORT_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  UNIVERSITY_DOMAINS: z
    .string()
    .default('')
    .transform(
      (v) =>
        Object.fromEntries(
          v
            .split(',')
            .map((pair) => pair.split('='))
            .map(
              ([domain, ...name]) => [domain?.trim().toLowerCase(), name.join('=').trim()] as const,
            )
            .filter(([domain, name]) => domain !== undefined && domain !== '' && name !== ''),
        ) as Record<string, string>,
    ),
};

/** MySQL 8.4. */
const database = {
  DATABASE_URL: z
    .url()
    .refine((v) => new URL(v).protocol === 'mysql:', { message: 'must be a mysql:// URL' }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  // Bounds acquiring a connection. A query on an established one is bounded
  // separately by whoever issues it.
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  // A Unix socket to the server, such as Cloud Run's `/cloudsql/<connection>`.
  // When set it replaces the host and port of DATABASE_URL (which still carries
  // the user, password and database). TLS does not apply to it: see
  // `tlsInProduction` below.
  DATABASE_SOCKET_PATH: z
    .string()
    .refine((v) => Buffer.byteLength(v) <= 107, {
      message: 'must be at most 107 bytes (the Unix socket path limit)',
    })
    .refine((v) => v.startsWith('/'), { message: 'must be an absolute path' })
    .refine((v) => !/[\s\0]/.test(v), { message: 'must not contain whitespace or NUL' })
    .optional(),
  // `required` verifies the server certificate against the system trust store
  // (or DATABASE_SSL_CA when set); `off` is for the local container, and for a
  // socket, which the connector already encrypts.
  DATABASE_SSL: z.enum(['off', 'required']).default('off'),
  DATABASE_SSL_CA: z.string().min(1).optional(),
  // How long `migrate` waits for another runner on the same database to
  // finish before giving up. 0 means do not wait.
  MIGRATION_LOCK_TIMEOUT_S: z.coerce.number().int().min(0).max(3600).default(60),
};

interface TlsInputs {
  NODE_ENV: string;
  DATABASE_SSL: string;
  DATABASE_SOCKET_PATH?: string | undefined;
}

/**
 * Production over the network must use TLS. A Unix socket is not the network:
 * the Cloud SQL connector behind it carries the traffic encrypted, and the
 * server offers no TLS on the socket, so `required` there would only make
 * every connection fail. The two settings are therefore exclusive.
 */
const tlsInProduction = (c: TlsInputs) =>
  c.NODE_ENV !== 'production' ||
  c.DATABASE_SOCKET_PATH !== undefined ||
  c.DATABASE_SSL === 'required';
const TLS_IN_PRODUCTION = {
  message: 'must be "required" in production (unless DATABASE_SOCKET_PATH is set)',
  path: ['DATABASE_SSL'],
};
const noTlsOnSocket = (c: TlsInputs) =>
  c.DATABASE_SOCKET_PATH === undefined || c.DATABASE_SSL === 'off';
const NO_TLS_ON_SOCKET = {
  message: 'TLS does not apply to a Unix socket: leave it "off" when DATABASE_SOCKET_PATH is set',
  path: ['DATABASE_SSL'],
};

/**
 * What the database tools need (migrate, seed, schema dump). They never verify
 * a token, so they must not require the Auth0 settings: the compose `migrate`
 * service runs with DATABASE_URL alone.
 */
export const databaseConfigSchema = z
  .object({ ...runtime, ...database })
  .refine(tlsInProduction, TLS_IN_PRODUCTION)
  .refine(noTlsOnSocket, NO_TLS_ON_SOCKET);

/** Everything the api process needs. */
export const configSchema = z
  .object({
    ...runtime,
    ...api,
    ...database,
    ...auth,
    ...rateLimit,
    ...profile,
    ...projects,
    ...notifications,
    ...discovery,
    ...dashboard,
    ...storage,
    ...integrations,
    ...suggestions,
  })
  .refine(tlsInProduction, TLS_IN_PRODUCTION)
  .refine(noTlsOnSocket, NO_TLS_ON_SOCKET)
  .refine((c) => c.NODE_ENV !== 'production' || c.AUTH0_ISSUER_BASE_URL.startsWith('https:'), {
    message: 'must be https in production',
    path: ['AUTH0_ISSUER_BASE_URL'],
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.GITHUB_API_BASE_URL.startsWith('https:'), {
    message: 'must be https in production',
    path: ['GITHUB_API_BASE_URL'],
  })
  // Half a credential pair is a typo, not a choice: refuse it at boot.
  .refine(
    (c) => (c.AUTH0_M2M_CLIENT_ID === undefined) === (c.AUTH0_M2M_CLIENT_SECRET === undefined),
    {
      message: 'AUTH0_M2M_CLIENT_ID and AUTH0_M2M_CLIENT_SECRET must be set together',
      path: ['AUTH0_M2M_CLIENT_SECRET'],
    },
  )
  .refine((c) => (c.GITHUB_CLIENT_ID === undefined) === (c.GITHUB_CLIENT_SECRET === undefined), {
    message: 'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together',
    path: ['GITHUB_CLIENT_SECRET'],
  })
  // A default page larger than the maximum would 400 every list that omits `limit`.
  .refine((c) => c.NOTIFICATIONS_PAGE_SIZE <= c.NOTIFICATIONS_PAGE_MAX, {
    message: 'must not exceed NOTIFICATIONS_PAGE_MAX',
    path: ['NOTIFICATIONS_PAGE_SIZE'],
  })
  .refine((c) => c.TEAMS_PAGE_SIZE <= c.TEAMS_PAGE_MAX, {
    message: 'must not exceed TEAMS_PAGE_MAX',
    path: ['TEAMS_PAGE_SIZE'],
  })
  .refine((c) => c.ACTIVITIES_PAGE_SIZE <= c.ACTIVITIES_PAGE_MAX, {
    message: 'must not exceed ACTIVITIES_PAGE_MAX',
    path: ['ACTIVITIES_PAGE_SIZE'],
  })
  .refine((c) => c.DISCOVERY_PAGE_SIZE <= c.DISCOVERY_PAGE_MAX, {
    message: 'must not exceed DISCOVERY_PAGE_MAX',
    path: ['DISCOVERY_PAGE_SIZE'],
  })
  .refine((c) => c.TAG_CLOUD_SIZE <= c.TAG_CLOUD_MAX, {
    message: 'must not exceed TAG_CLOUD_MAX',
    path: ['TAG_CLOUD_SIZE'],
  })
  .refine((c) => c.SEARCH_GROUP_SIZE <= c.DISCOVERY_PAGE_MAX, {
    message: 'must not exceed DISCOVERY_PAGE_MAX',
    path: ['SEARCH_GROUP_SIZE'],
  })
  .refine((c) => c.SUGGESTIONS_PAGE_SIZE <= c.SUGGESTIONS_PAGE_MAX, {
    message: 'must not exceed SUGGESTIONS_PAGE_MAX',
    path: ['SUGGESTIONS_PAGE_SIZE'],
  })
  .refine((c) => c.PROJECTS_PAGE_SIZE <= c.PROJECTS_PAGE_MAX, {
    message: 'must not exceed PROJECTS_PAGE_MAX',
    path: ['PROJECTS_PAGE_SIZE'],
  });

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type AppConfig = z.infer<typeof configSchema>;

/** The five credentials GitHub connect needs, present together (docs/m7-plan.md §8, D9). */
export interface GithubIntegrationSettings {
  auth0ClientId: string;
  m2mClientId: string;
  m2mClientSecret: string;
  githubClientId: string;
  githubClientSecret: string;
}

/** The GitHub connect credentials, or undefined when any is unset (every GitHub route 503s). */
export function githubIntegrationSettings(cfg: AppConfig): GithubIntegrationSettings | undefined {
  const {
    AUTH0_CLIENT_ID: auth0ClientId,
    AUTH0_M2M_CLIENT_ID: m2mClientId,
    AUTH0_M2M_CLIENT_SECRET: m2mClientSecret,
    GITHUB_CLIENT_ID: githubClientId,
    GITHUB_CLIENT_SECRET: githubClientSecret,
  } = cfg;
  if (
    auth0ClientId === undefined ||
    m2mClientId === undefined ||
    m2mClientSecret === undefined ||
    githubClientId === undefined ||
    githubClientSecret === undefined
  ) {
    return undefined;
  }
  return { auth0ClientId, m2mClientId, m2mClientSecret, githubClientId, githubClientSecret };
}
