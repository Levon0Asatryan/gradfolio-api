import { Writable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { pino, type Logger } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index.js';
import {
  loggerOptions,
  REDACT_CENSOR,
  REDACT_PATHS,
  requestSerializer,
  requestUrlPath,
} from './index.js';

function capture(): { logger: Logger; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const logger = pino({ redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR } }, stream);
  return {
    logger,
    lines: () => chunks.map((c) => JSON.parse(c) as Record<string, unknown>),
  };
}

describe('redaction', () => {
  it('never writes the bearer token', () => {
    const { logger, lines } = capture();
    logger.info({ req: { headers: { authorization: 'Bearer eyJ.secret.sig' } } }, 'x');

    const line = JSON.stringify(lines()[0]);
    expect(line).not.toContain('eyJ.secret.sig');
    expect(line).toContain(REDACT_CENSOR);
  });

  it.each(['phone', 'birthday', 'accessToken', 'refresh_token'])(
    'never writes a nested %s',
    (field) => {
      const { logger, lines } = capture();
      logger.info({ user: { [field]: 'SENSITIVE-VALUE' } }, 'x');
      expect(JSON.stringify(lines()[0])).not.toContain('SENSITIVE-VALUE');
    },
  );
});

describe('requestSerializer', () => {
  it('drops the query string and the query object', () => {
    const req = {
      method: 'GET',
      url: '/v1/search?q=private-term',
      headers: {},
      socket: {},
    } as unknown as IncomingMessage;

    const out = requestSerializer(req);

    expect(out.url).toBe('/v1/search');
    expect(out).not.toHaveProperty('query');
    expect(JSON.stringify(out)).not.toContain('private-term');
  });

  it('keeps a path with no query unchanged', () => {
    expect(requestUrlPath('/readyz')).toBe('/readyz');
  });
});

describe('loggerOptions', () => {
  const base = {
    DATABASE_URL: 'mysql://u:p@localhost:3306/db',
    AUTH0_ISSUER_BASE_URL: 'https://tenant.test/',
    AUTH0_AUDIENCE: 'https://api.test',
  };

  it('pretty-prints only when asked, never by default -- the image has no pino-pretty', () => {
    const pretty = loggerOptions(loadConfig({ ...base, LOG_FORMAT: 'pretty' }));
    const devDefault = loggerOptions(loadConfig({ ...base, NODE_ENV: 'development' }));

    expect(JSON.stringify(pretty)).toContain('pino-pretty');
    expect(JSON.stringify(devDefault)).not.toContain('pino-pretty');
  });

  it('carries the configured level and the redaction list', () => {
    const opts = loggerOptions(loadConfig({ ...base, LOG_LEVEL: 'warn' })).pinoHttp as {
      level: string;
      redact: { paths: string[] };
    };
    expect(opts.level).toBe('warn');
    expect(opts.redact.paths).toContain('req.headers.authorization');
  });
});
