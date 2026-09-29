import { describe, expect, it } from 'vitest';
import { chars, fits, limitedString, measure, TEXT } from './text.js';

describe('column limits, counted the way MySQL counts them', () => {
  const varchar500 = chars(500);

  it.each([
    ['500 ASCII', 'a'.repeat(500), true],
    ['501 ASCII', 'a'.repeat(501), false],
    ['500 Armenian letters', 'Ա'.repeat(500), true],
    ['501 Armenian letters', 'Ա'.repeat(501), false],
    // JS length 1000, but 500 characters: MySQL accepts it (run on 8.4.11).
    ['500 emoji', '😀'.repeat(500), true],
    ['501 emoji', '😀'.repeat(501), false],
    // 1000 code points: MySQL rejects it (1406).
    ['500 × e + combining acute', 'é'.repeat(500), false],
  ])('VARCHAR(500): %s -> %s', (_label, value, ok) => {
    expect(fits(value, varchar500)).toBe(ok);
    expect(limitedString(varchar500).safeParse(value).success).toBe(ok);
  });

  it.each([
    ['65,535 ASCII bytes', 'a'.repeat(65_535), true],
    ['65,536 ASCII bytes', 'a'.repeat(65_536), false],
    ['16,383 emoji (65,532 bytes)', '😀'.repeat(16_383), true],
    ['16,384 emoji (65,536 bytes)', '😀'.repeat(16_384), false],
  ])('TEXT: %s -> %s', (_label, value, ok) => {
    expect(fits(value, TEXT)).toBe(ok);
  });

  it('measures characters or bytes, as the limit says', () => {
    expect(measure('😀', chars(1))).toBe(1);
    expect(measure('😀', TEXT)).toBe(4);
  });

  it('says which unit it counted in the message', () => {
    expect(limitedString(chars(1)).safeParse('ab').error?.issues[0]?.message).toMatch(
      /1 characters/,
    );
    expect(limitedString(TEXT).safeParse('a'.repeat(70_000)).error?.issues[0]?.message).toMatch(
      /65535 bytes/,
    );
  });
});
