import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from './app-error.js';
import { toErrorResponse } from './http-mapping.js';

describe('toErrorResponse', () => {
  it('passes an AppError through with its code, message and details', () => {
    const mapped = toErrorResponse(new ValidationError([{ path: 'title', message: 'required' }]));

    expect(mapped.status).toBe(400);
    expect(mapped.body).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'request failed validation',
      details: [{ path: 'title', message: 'required' }],
    });
    expect(mapped.isServerFault).toBe(false);
  });

  it('answers 404 for another user’s resource', () => {
    expect(toErrorResponse(new NotFoundError('project'))).toMatchObject({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'project not found' },
    });
  });

  it('keeps a domain conflict code', () => {
    expect(toErrorResponse(new ConflictError('ALREADY_MEMBER', 'already a member')).body.code).toBe(
      'ALREADY_MEMBER',
    );
  });

  it('replaces Nest’s default exception body with a stable code', () => {
    const mapped = toErrorResponse(new NotFoundException());
    expect(mapped).toMatchObject({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'resource not found' },
    });
    expect(mapped.body).not.toHaveProperty('statusCode');
  });

  it('never forwards the free-text message a handler put in a Nest exception', () => {
    const mapped = toErrorResponse(new BadRequestException('SELECT * FROM users failed'));
    expect(JSON.stringify(mapped.body)).not.toContain('SELECT');
    expect(mapped.body.code).toBe('BAD_REQUEST');
  });

  it('keeps a body a handler built deliberately in the error shape, and nothing else from it', () => {
    const mapped = toErrorResponse(
      new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'database is not reachable',
        stack: 'leak',
      }),
    );
    expect(mapped.body).toEqual({
      code: 'DATABASE_UNAVAILABLE',
      message: 'database is not reachable',
    });
  });

  it('maps body-parser’s too-large error to 413', () => {
    const err = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });
    expect(toErrorResponse(err)).toMatchObject({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE' },
    });
    expect(toErrorResponse(new PayloadTooLargeException()).status).toBe(413);
  });

  it('maps a database outage to 503, not 500', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), {
      code: 'ECONNREFUSED',
    });
    const mapped = toErrorResponse(err);
    expect(mapped).toMatchObject({ status: 503, body: { code: 'DATABASE_UNAVAILABLE' } });
    expect(JSON.stringify(mapped.body)).not.toContain('127.0.0.1');
    expect(mapped.logDetail).toContain('127.0.0.1');
  });

  it('hides everything about an unknown error from the client, and logs it', () => {
    const err = Object.assign(new Error("Table 'gradfolio.users' doesn't exist"), {
      code: 'ER_NO_SUCH_TABLE',
    });
    const mapped = toErrorResponse(err);

    expect(mapped).toMatchObject({
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'an unexpected error occurred' },
      isServerFault: true,
    });
    expect(JSON.stringify(mapped.body)).not.toContain('gradfolio.users');
    expect(mapped.logDetail).toContain('ER_NO_SUCH_TABLE');
  });

  it.each([{ status: 200 }, { status: '404' }, { status: 999 }])(
    'does not trust a non-error status %j',
    (value) => {
      expect(toErrorResponse(value).status).toBe(500);
    },
  );

  it('ignores a getResponse that is not a function', () => {
    expect(toErrorResponse({ status: 404, getResponse: 'nope' }).body.code).toBe('NOT_FOUND');
  });

  it('gives an unlisted HTTP status a generic body', () => {
    expect(toErrorResponse({ status: 418 }).body).toEqual({
      code: 'ERROR',
      message: 'request failed',
    });
  });
});
