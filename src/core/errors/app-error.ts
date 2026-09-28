/**
 * Domain errors carry a stable machine-readable code, so a client can branch
 * on the failure without parsing prose and without the message becoming an
 * accidental API contract.
 */
export class AppError extends Error {
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
