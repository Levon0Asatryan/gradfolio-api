import { describe, expect, it } from 'vitest';
import { linkList, stringList } from '../validation/json-shapes.js';
import { toJsonColumn } from './json.js';

describe('toJsonColumn', () => {
  it('serializes what the schema returned, normalized', () => {
    expect(toJsonColumn(stringList({ maxItems: 5 }), [' a ', 'b'])).toBe('["a","b"]');
  });

  it('refuses a value of the wrong shape instead of writing it', () => {
    expect(() => toJsonColumn(stringList({ maxItems: 5 }), { a: 1 })).toThrow();
    expect(() =>
      toJsonColumn(linkList({ maxItems: 5 }), [{ label: 'x', url: 'javascript:x' }]),
    ).toThrow();
  });

  it('writes an empty list as [], not as SQL NULL', () => {
    expect(toJsonColumn(stringList({ maxItems: 5 }), [])).toBe('[]');
  });
});
