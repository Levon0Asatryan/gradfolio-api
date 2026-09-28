import { describe, expect, it } from 'vitest';
import { DATABASE_UNAVAILABLE_CODES, isDatabaseUnavailable } from './database-unavailable.js';

function withCode(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('isDatabaseUnavailable', () => {
  it.each([...DATABASE_UNAVAILABLE_CODES])('treats %s as an outage', (code) => {
    expect(isDatabaseUnavailable(withCode(code))).toBe(true);
  });

  it.each(['ER_DUP_ENTRY', 'ER_PARSE_ERROR', 'ER_NO_SUCH_TABLE', 'ER_ACCESS_DENIED_ERROR'])(
    'treats %s as a real error, not an outage',
    (code) => {
      expect(isDatabaseUnavailable(withCode(code))).toBe(false);
    },
  );

  it('finds an outage inside an AggregateError', () => {
    expect(
      isDatabaseUnavailable(new AggregateError([new Error('x'), withCode('ECONNREFUSED')])),
    ).toBe(true);
  });

  it('finds an outage in the cause chain', () => {
    expect(isDatabaseUnavailable(new Error('wrapped', { cause: withCode('ETIMEDOUT') }))).toBe(
      true,
    );
  });

  it('stops on a circular cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    Object.assign(a, { cause: b });
    expect(isDatabaseUnavailable(a)).toBe(false);
  });

  it.each([null, undefined, 'ECONNREFUSED', { code: 42 }])('is false for %j', (value) => {
    expect(isDatabaseUnavailable(value)).toBe(false);
  });
});
