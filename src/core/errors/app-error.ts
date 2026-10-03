/**
 * Domain errors carry a stable machine-readable code, so a client can branch
 * on the failure without parsing prose and without the message becoming an
 * accidental API contract.
 */
export class AppError extends Error {
  /** Response headers this failure requires (`WWW-Authenticate`, `Retry-After`). */
  headers?: Readonly<Record<string, string>>;
  /**
   * What the log says instead of the message, when the cause must be described
   * without quoting it (a library's text, a token's claims).
   */
  logDetail?: string;

  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    // 404 rather than 403 for a resource owned by someone else: telling a
    // caller that an id exists but is not theirs is itself a disclosure.
    super('NOT_FOUND', `${what} not found`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('VALIDATION_FAILED', 'request failed validation', 400, details);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('RATE_LIMITED', 'too many requests', 429);
    this.headers = { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) };
  }
}
