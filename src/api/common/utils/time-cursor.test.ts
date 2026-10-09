import { describe, expect, it } from 'vitest';
import { decodeTimeCursor, encodeTimeCursor } from './time-cursor.js';

describe('time cursor', () => {
  it('round-trips', () => {
    const c = { t: 1_760_000_000_000, id: 'abc' };
    expect(decodeTimeCursor(encodeTimeCursor(c))).toEqual(c);
  });

  it('accepts the last time a DATETIME can hold', () => {
    const c = { t: 253_402_300_799_999, id: 'a' };
    expect(decodeTimeCursor(encodeTimeCursor(c))).toEqual(c);
  });

  it.each([
    ['not base64 json', '!!!'],
    ['a string time', Buffer.from('{"t":"1","id":"a"}').toString('base64url')],
    ['an unknown key', Buffer.from('{"t":1,"id":"a","x":1}').toString('base64url')],
    [
      'a time beyond the DATETIME range',
      Buffer.from('{"t":253402300800000,"id":"a"}').toString('base64url'),
    ],
    ['a negative time', Buffer.from('{"t":-1,"id":"a"}').toString('base64url')],
    ['an oversized id', Buffer.from(`{"t":1,"id":"${'a'.repeat(37)}"}`).toString('base64url')],
  ])('rejects %s', (_name, raw) => {
    expect(decodeTimeCursor(raw)).toBeUndefined();
  });
});
