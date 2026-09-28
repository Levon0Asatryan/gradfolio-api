import { AppError } from './app-error.js';
import { isDatabaseUnavailable } from './database-unavailable.js';
import { describeError } from './describe.js';

/** The body of every failed response. Nothing internal ever goes in it. */
export interface ErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}

export interface MappedError {
  status: number;
  body: ErrorResponse;
  /** The cause, for the log only. */
  logDetail: string;
  isServerFault: boolean;
}

/** Stable codes for the statuses Nest and Express raise on their own. */
const STATUS_CODES: Record<number, ErrorResponse> = {
  400: { code: 'BAD_REQUEST', message: 'request could not be understood' },
  401: { code: 'UNAUTHENTICATED', message: 'authentication required' },
  403: { code: 'FORBIDDEN', message: 'not permitted' },
  404: { code: 'NOT_FOUND', message: 'resource not found' },
  405: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' },
  409: { code: 'CONFLICT', message: 'request conflicts with current state' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'request body is too large' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'unsupported content type' },
  429: { code: 'RATE_LIMITED', message: 'too many requests' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'service is not available' },
};

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

/** Nest's HttpException and body-parser's errors both carry a numeric `status`. */
function httpStatusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('status' in err)) return undefined;
  const { status } = err;
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : undefined;
}

/** Nest's HttpException exposes its body through getResponse(). */
function httpBodyOf(err: unknown): unknown {
  if (typeof err === 'object' && err !== null && 'getResponse' in err) {
    const get = err.getResponse;
    if (typeof get === 'function') return (get as () => unknown).call(err);
  }
  return undefined;
}

/**
 * Maps any thrown value to a status, a safe body and a log line.
 *
 * Only an AppError's own message, or a body a handler built deliberately in
 * the `{ code, message }` shape, reaches the client. Everything else gets a
 * fixed message per status, so a driver error, SQL text or stack trace can
 * never leak through a response.
 */
export function toErrorResponse(err: unknown): MappedError {
  const logDetail = describeError(err);

  if (err instanceof AppError) {
    const body: ErrorResponse = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    return { status: err.status, body, logDetail, isServerFault: err.status >= 500 };
  }

  const status = httpStatusOf(err);
  if (status !== undefined) {
    const response = httpBodyOf(err);
    const body = isErrorResponse(response)
      ? { code: response.code, message: response.message }
      : (STATUS_CODES[status] ?? { code: 'ERROR', message: 'request failed' });
    return { status, body, logDetail, isServerFault: status >= 500 };
  }

  if (isDatabaseUnavailable(err)) {
    return {
      status: 503,
      body: { code: 'DATABASE_UNAVAILABLE', message: 'database is not reachable' },
      logDetail,
      isServerFault: true,
    };
  }

  return {
    status: 500,
    body: { code: 'INTERNAL_ERROR', message: 'an unexpected error occurred' },
    logDetail,
    isServerFault: true,
  };
}
