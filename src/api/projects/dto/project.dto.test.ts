import { describe, expect, it } from 'vitest';
import { myProjectsQuerySchema, userProjectsQuerySchema } from './project.dto.js';

describe('project list queries', () => {
  it('defaults the sort and leaves the rest unset', () => {
    expect(userProjectsQuerySchema.parse({})).toEqual({ sort: 'newest' });
  });

  it('coerces and normalizes', () => {
    expect(
      myProjectsQuerySchema.parse({ limit: '7', q: '  gar ', tag: '  Web   Dev ', state: 'draft' }),
    ).toEqual({ sort: 'newest', limit: 7, q: 'gar', tag: 'Web Dev', state: 'draft' });
  });

  it.each([
    ['an unknown key', { owner: 'x' }],
    ['`state` on the public list', { state: 'draft' }],
    ['a bad sort', { sort: 'random' }],
    ['a bad category', { category: 'fun' }],
    ['limit 0', { limit: '0' }],
    ['a fractional limit', { limit: '1.5' }],
    ['an empty q', { q: '   ' }],
    ['a long q', { q: 'x'.repeat(101) }],
    ['a repeated key', { tag: ['a', 'b'] }],
  ])('refuses %s', (_name, query) => {
    const schema = 'state' in query ? userProjectsQuerySchema : myProjectsQuerySchema;
    expect(schema.safeParse(query).success).toBe(false);
  });
});
