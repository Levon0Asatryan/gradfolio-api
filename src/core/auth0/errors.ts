import { AppError } from '../errors/app-error.js';

/**
 * 503: GitHub connect is not configured (D9: all five credentials or none), or
 * Auth0's Management API could not be used (unreachable, over its rate limit,
 * refusing our credentials). The cause goes to the log, never to the response.
 */
export class IntegrationUnavailableError extends AppError {
  constructor(cause: string, retryAfterSeconds?: number) {
    super('INTEGRATION_UNAVAILABLE', 'the integration is temporarily unavailable', 503);
    this.logDetail = `integration unavailable: ${cause}`;
    if (retryAfterSeconds !== undefined) {
      this.headers = { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) };
    }
  }
}
