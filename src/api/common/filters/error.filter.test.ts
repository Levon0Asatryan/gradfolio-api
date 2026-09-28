import type { ArgumentsHost } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { ErrorFilter } from './error.filter.js';

function harness(url = '/v1/projects/abc?q=secret') {
  const logger = { error: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'GET', url }),
    }),
  } as unknown as ArgumentsHost;
  return { filter: new ErrorFilter(logger), logger, host, status, json };
}

describe('ErrorFilter', () => {
  it('logs a client error as a warning and answers with the mapped body', () => {
    const { filter, logger, host, status, json } = harness();

    filter.catch(new NotFoundException(), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ code: 'NOT_FOUND', message: 'resource not found' });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a server fault as an error, with the cause, and hides the cause from the client', () => {
    const { filter, logger, host, json } = harness();

    filter.catch(new Error('driver exploded at 10.0.0.5'), host);

    expect(json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'an unexpected error occurred',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500, cause: 'driver exploded at 10.0.0.5' }),
      'request failed',
    );
  });

  it('never logs the query string', () => {
    const { filter, logger, host } = harness('/v1/search?q=private-term');

    filter.catch(new NotFoundException(), host);

    const [fields] = vi.mocked(logger.warn).mock.calls[0] as [Record<string, unknown>];
    expect(fields.path).toBe('/v1/search');
    expect(JSON.stringify(fields)).not.toContain('private-term');
  });
});
