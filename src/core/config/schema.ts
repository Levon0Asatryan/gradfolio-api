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

  // Whether X-Forwarded-For may be believed. Off unless a deployment behind a
  // proxy opts in: a header any client can set must not decide who the client is.
  TRUST_PROXY: envBoolean('false'),

  // Bounds the readiness check's response, not the query itself.
  HEALTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(3000),
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
  // Aiven requires TLS. `required` verifies the server certificate against the
  // system trust store (or DATABASE_SSL_CA when set); `off` is for the local
  // container only.
  DATABASE_SSL: z.enum(['off', 'required']).default('off'),
  DATABASE_SSL_CA: z.string().min(1).optional(),
};

export const configSchema = z
  .object({ ...runtime, ...api, ...database })
  .refine((c) => c.NODE_ENV !== 'production' || c.DATABASE_SSL === 'required', {
    message: 'must be "required" in production',
    path: ['DATABASE_SSL'],
  });

export type AppConfig = z.infer<typeof configSchema>;
