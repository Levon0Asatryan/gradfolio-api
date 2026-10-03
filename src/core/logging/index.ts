import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { AppConfig } from '../config/schema.js';
import { REDACT_CENSOR, REDACT_PATHS } from './redaction.js';
import { requestSerializer } from './request-serializer.js';

export { REDACT_CENSOR, REDACT_PATHS } from './redaction.js';
export { requestSerializer, requestUrlPath } from './request-serializer.js';

/**
 * Structured logging. The message is a static string and variable data goes in
 * fields, so logs stay greppable and aggregatable.
 */
/**
 * Injection token for where log lines go. Unset in the application (stdout);
 * tests override it to read what the real pipeline wrote.
 */
export const LOG_DESTINATION = Symbol('LOG_DESTINATION');

export function loggerOptions(cfg: AppConfig, destination?: DestinationStream | null): Params {
  const pretty = cfg.LOG_FORMAT === 'pretty';
  const options = {
    level: cfg.LOG_LEVEL,
    base: { service: 'gradfolio-api' },
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    serializers: { req: requestSerializer },
    // Pretty output is for a human at a terminal; production stays JSON.
    transport: pretty ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
  };

  return { pinoHttp: destination ? [options, destination] : options };
}
