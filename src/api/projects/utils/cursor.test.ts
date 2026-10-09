import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, PROJECT_SORTS } from './cursor.js';

describe('project cursors', () => {
  it('round-trips a date cursor and a text cursor', () => {
    const date = encodeCursor('newest', { v: 1_700_000_000_000, id: 'abc' });
    expect(decodeCursor(date, 'newest')).toEqual({ v: 1_700_000_000_000, id: 'abc' });
    const text = encodeCursor('name_asc', { v: 'Zeta', id: 'abc' });
    expect(decodeCursor(text, 'name_asc')).toEqual({ v: 'Zeta', id: 'abc' });
  });

  it('refuses a cursor made for another sort, even one of the same kind', () => {
    const made = encodeCursor('newest', { v: 5, id: 'a' });
    for (const other of PROJECT_SORTS.filter((s) => s !== 'newest')) {
      expect(decodeCursor(made, other), other).toBeUndefined();
    }
  });

  it.each([
    ['not base64 json', '!!!'],
    ['json that is not an object', Buffer.from('[1]').toString('base64url')],
    ['an unknown key', Buffer.from('{"s":"newest","v":1,"id":"a","x":1}').toString('base64url')],
    [
      'a text value for a date sort',
      Buffer.from('{"s":"newest","v":"1","id":"a"}').toString('base64url'),
    ],
    [
      'a number for a text sort',
      Buffer.from('{"s":"name_asc","v":1,"id":"a"}').toString('base64url'),
    ],
    ['a negative number', Buffer.from('{"s":"newest","v":-1,"id":"a"}').toString('base64url')],
    [
      'an id that is too long',
      Buffer.from(`{"s":"newest","v":1,"id":"${'a'.repeat(37)}"}`).toString('base64url'),
    ],
  ])('refuses %s', (_name, raw) => {
    expect(decodeCursor(raw, raw.includes('name_asc') ? 'name_asc' : 'newest')).toBeUndefined();
  });
});
