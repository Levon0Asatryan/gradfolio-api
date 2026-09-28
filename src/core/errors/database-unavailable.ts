/**
 * Error codes meaning "the database could not be reached or dropped us",
 * as opposed to "the database answered and refused this statement".
 *
 * The first kind is an outage: every route answers 503 DATABASE_UNAVAILABLE,
 * not 500, which would read as a bug. The second is a real error and must stay
 * a 500. Codes come from Node's net layer and from mysql2's protocol layer;
 * the ones a real outage produces are exercised against a real server in
 * database-unavailable.int.test.ts.
 */
export const DATABASE_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  // Node net / DNS
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  // mysql2 protocol
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  // MySQL server
  'ER_CON_COUNT_ERROR',
  'ER_SERVER_SHUTDOWN',
]);

function codeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
  return typeof value.code === 'string' ? value.code : undefined;
}

/** True when `err`, its cause, or any constituent of an AggregateError is an outage code. */
export function isDatabaseUnavailable(err: unknown, depth = 0): boolean {
  if (depth > 3) return false;

  const code = codeOf(err);
  if (code !== undefined && DATABASE_UNAVAILABLE_CODES.has(code)) return true;

  if (err instanceof AggregateError && Array.isArray(err.errors)) {
    if (err.errors.some((e: unknown) => isDatabaseUnavailable(e, depth + 1))) return true;
  }

  if (err instanceof Error && err.cause !== undefined) {
    return isDatabaseUnavailable(err.cause, depth + 1);
  }

  return false;
}
