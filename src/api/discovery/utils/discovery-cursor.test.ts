import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './discovery-cursor.js';

const raw = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

describe('discovery cursors', () => {
  it('round-trips a ranked and a time-ordered cursor for their own list', () => {
    const ranked = encodeCursor('search-people', { r: 2, t: 1_700_000_000_000, id: 'abc' });
    expect(decodeCursor(ranked, 'search-people', true)).toEqual({
      r: 2,
      t: 1_700_000_000_000,
      id: 'abc',
    });
    const timed = encodeCursor('tag-projects', { t: 5, id: 'x' });
    expect(decodeCursor(timed, 'tag-projects', false)).toEqual({ t: 5, id: 'x' });
  });

  it.each([
    [
      'another list',
      encodeCursor('search-people', { r: 1, t: 1, id: 'a' }),
      'search-projects',
      true,
    ],
    ['a ranked cursor on a time list', encodeCursor('x', { r: 1, t: 1, id: 'a' }), 'x', false],
    ['a time cursor on a ranked list', encodeCursor('x', { t: 1, id: 'a' }), 'x', true],
    ['rank 9', raw({ r: 9, t: 1, id: 'a', s: 'x' }), 'x', true],
    ['a negative time', raw({ r: 1, t: -1, id: 'a', s: 'x' }), 'x', true],
    ['a time past DATETIME', raw({ r: 1, t: 253_402_300_800_000, id: 'a', s: 'x' }), 'x', true],
    ['a 5 KB id', raw({ r: 1, t: 1, id: 'a'.repeat(5000), s: 'x' }), 'x', true],
    ['an extra key', raw({ r: 1, t: 1, id: 'a', s: 'x', z: 1 }), 'x', true],
    ['not JSON', 'nope', 'x', true],
  ])('rejects %s', (_n, cursor, scope, ranked) => {
    expect(decodeCursor(cursor, scope, ranked)).toBeUndefined();
  });

  it('accepts a forged cursor of the right shape: it is not authenticated, only positional', () => {
    // The guarantee (plan §3.1) is that such a cursor cannot widen the listing;
    // the integration suite proves that against MySQL.
    expect(decodeCursor(raw({ r: 0, t: 1, id: 'zzz', s: 'x' }), 'x', true)).toEqual({
      r: 0,
      t: 1,
      id: 'zzz',
    });
  });
});
