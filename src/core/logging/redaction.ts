/**
 * Paths pino replaces before a line is written.
 *
 * The bearer token is the one that matters most: it is a live credential for
 * the caller's account until it expires. Private profile fields are listed too,
 * because a handler that logs a request body or a row would otherwise write a
 * student's phone number or birthday into every log aggregator downstream.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.secret',
  '*.accessToken',
  '*.access_token',
  '*.refreshToken',
  '*.refresh_token',
  '*.idToken',
  '*.id_token',
  '*.clientSecret',
  '*.client_secret',
  '*.phone',
  '*.birthday',
  // A user row or a token's identity, if a handler ever logs one (M2).
  '*.email',
  '*.claims',
] as const;

export const REDACT_CENSOR = '[redacted]';
