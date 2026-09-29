import { describe, expect, it } from 'vitest';
import { COLUMN_LIMITS, columnString } from './columns.js';
import { httpUrl, isHttpUrl } from './http-url.js';
import { linkList, stringList, translationParams } from './json-shapes.js';
import { chars } from './text.js';
import { yearMonth } from './year-month.js';

describe('yearMonth', () => {
  it.each(['2024-01', '1999-12', '2025-09'])('accepts %j', (v) => {
    expect(yearMonth.safeParse(v).success).toBe(true);
  });
  it.each(['banana', '2024-13', '2024-00', '2024-1', '24-01', '2024-01-01', ' 2024-01', ''])(
    'rejects %j',
    (v) => {
      expect(yearMonth.safeParse(v).success).toBe(false);
    },
  );
});

describe('httpUrl', () => {
  it.each(['https://github.com/a/b', 'http://example.com', 'HTTPS://EXAMPLE.COM/x'])(
    'accepts %j',
    (v) => {
      expect(httpUrl().safeParse(v).success).toBe(true);
    },
  );
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com/f',
    '/uploads/spec.pdf',
    'example.com',
    '',
  ])('rejects %j', (v) => {
    expect(isHttpUrl(v)).toBe(false);
    expect(httpUrl().safeParse(v).success).toBe(false);
  });
  it('rejects a URL longer than its column', () => {
    expect(httpUrl(chars(20)).safeParse('https://example.com/abc').success).toBe(false);
  });
});

describe('stringList', () => {
  const schema = stringList({ maxItems: 3 });
  it('trims items and keeps order', () => {
    expect(schema.parse([' a ', 'b'])).toEqual(['a', 'b']);
  });
  it.each([
    ['an object', { a: 1 }],
    ['a string', 'a'],
    ['numbers', [1, 2]],
    ['an empty item', ['a', '  ']],
    ['too many items', ['a', 'b', 'c', 'd']],
    ['an item over 1000 characters', ['x'.repeat(1001)]],
    ['null inside', ['a', null]],
  ])('rejects %s', (_label, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

describe('linkList', () => {
  const schema = linkList({ maxItems: 2 });
  it('accepts {label, url} with an http(s) url', () => {
    expect(schema.parse([{ label: ' Paper ', url: 'https://arxiv.org/abs/1' }])).toEqual([
      { label: 'Paper', url: 'https://arxiv.org/abs/1' },
    ]);
  });
  it.each([
    ['a javascript: url', [{ label: 'x', url: 'javascript:alert(1)' }]],
    ['a relative url', [{ label: 'x', url: '/uploads/spec.pdf' }]],
    ['no url', [{ label: 'x' }]],
    ['an empty label', [{ label: ' ', url: 'https://x.dev' }]],
    ['an extra key', [{ label: 'x', url: 'https://x.dev', onclick: 'x' }]],
    ['strings', ['https://x.dev']],
    ['too many', Array.from({ length: 3 }, () => ({ label: 'x', url: 'https://x.dev' }))],
  ])('rejects %s', (_label, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

describe('translationParams', () => {
  it('accepts string and number values', () => {
    expect(translationParams.safeParse({ projectName: 'X', count: 3 }).success).toBe(true);
  });
  it.each([
    ['an array', [1]],
    ['a nested object', { a: { b: 1 } }],
    ['a boolean value', { a: true }],
    ['Infinity', { a: Infinity }],
  ])('rejects %s', (_label, value) => {
    expect(translationParams.safeParse(value).success).toBe(false);
  });
});

describe('columnString', () => {
  it('uses the column’s real limit', () => {
    expect(COLUMN_LIMITS['users.headline']).toEqual(chars(500));
    expect(columnString('users.headline').safeParse('😀'.repeat(500)).success).toBe(true);
    expect(columnString('users.headline').safeParse('😀'.repeat(501)).success).toBe(false);
  });
});
