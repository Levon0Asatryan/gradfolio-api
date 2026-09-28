import { describe, expect, it } from 'vitest';
import { describeError } from './describe.js';

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeError', () => {
  it('prefixes a Node error code', () => {
    expect(describeError(withCode('connect failed', 'ECONNREFUSED'))).toBe(
      'ECONNREFUSED: connect failed',
    );
  });

  it('does not repeat a code that is the whole message', () => {
    expect(describeError(withCode('ETIMEDOUT', 'ETIMEDOUT'))).toBe('ETIMEDOUT');
  });

  it('falls back to the code, then the name, when the message is empty', () => {
    expect(describeError(withCode('', 'EPIPE'))).toBe('EPIPE');
    expect(describeError(new TypeError(''))).toBe('TypeError');
  });

  it('expands an AggregateError, whose own message is empty', () => {
    const agg = new AggregateError(
      [withCode('connect 1', 'ECONNREFUSED'), withCode('connect 1', 'ECONNREFUSED')],
      '',
    );
    expect(describeError(agg)).toBe('ECONNREFUSED: connect 1');
  });

  it('appends one level of cause, including an aggregate cause', () => {
    const inner = new AggregateError([
      withCode('a', 'ECONNREFUSED'),
      withCode('b', 'EHOSTUNREACH'),
    ]);
    const err = new Error('pool failed', { cause: inner });
    expect(describeError(err)).toBe('pool failed (cause: ECONNREFUSED: a; EHOSTUNREACH: b)');
  });

  it('terminates on a circular cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    Object.assign(a, { cause: b });
    expect(describeError(a)).toBe('a (cause: b)');
  });

  it.each([
    ['plain', 'plain'],
    [null, 'null'],
    [undefined, 'undefined'],
    [42, '42'],
    [10n, '10n'],
    [Symbol('s'), 'Symbol(s)'],
  ])('describes %s', (value, expected) => {
    expect(describeError(value)).toBe(expected);
  });

  it('stringifies objects, surviving cycles and BigInt', () => {
    const obj: Record<string, unknown> = { n: 1n };
    obj.self = obj;
    expect(describeError(obj)).toBe('{"n":"1n","self":"[circular]"}');
  });

  it('never throws, even when a getter does', () => {
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'message', {
      get() {
        throw new Error('boom');
      },
    });
    expect(() => describeError(hostile)).not.toThrow();
    expect(describeError(hostile)).toBe('[object Error]');
  });

  it('falls back to the type tag when an object has no JSON form', () => {
    expect(describeError({ toJSON: () => undefined })).toBe('[object Object]');
  });

  it('describes non-Error constituents of an AggregateError', () => {
    expect(describeError(new AggregateError(['text', 7], ''))).toBe('text; [object Number]');
  });

  it('uses the aggregate’s own message, or its name, when it has no constituents', () => {
    expect(describeError(new AggregateError([], 'all attempts failed'))).toBe(
      'all attempts failed',
    );
    expect(describeError(new AggregateError([], ''))).toBe('AggregateError');
  });

  it('describes a non-Error cause', () => {
    expect(describeError(new Error('x', { cause: 'plain reason' }))).toBe(
      'x (cause: plain reason)',
    );
    expect(describeError(new Error('x', { cause: 42 }))).toBe('x (cause: [object Number])');
    expect(describeError(new Error('x', { cause: new Error('inner') }))).toBe('x (cause: inner)');
  });

  it('never throws on a toJSON that throws', () => {
    const value = {
      toJSON() {
        throw new Error('nope');
      },
    };
    expect(describeError(value)).toBe('[object Object]');
  });
});
