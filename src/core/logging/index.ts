import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../config/schema.js';
import { REDACT_CENSOR, REDACT_PATHS } from './redaction.js';
import { requestSerializer } from './request-serializer.js';

export { REDACT_CENSOR, REDACT_PATHS } from './redaction.js';
export { requestSerializer, requestUrlPath } from './request-serializer.js';

/**
 * Structured logging. The message is a static string and variable data goes in
 * fields, so logs stay greppable and aggregatable.
 */
export function loggerOptions(cfg: AppConfig): Params {
  const pretty = cfg.LOG_FORMAT === 'pretty';

  return {
    pinoHttp: {
      level: cfg.LOG_LEVEL,
      base: { service: 'gradfolio-api' },
      redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
      serializers: { req: requestSerializer },
      // Pretty output is for a human at a terminal; production stays JSON.
      transport: pretty ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    },
  };
}
