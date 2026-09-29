import { describe, expect, it } from 'vitest';
import { normalizeTerm, term, termList } from './terms.js';

describe('normalizeTerm', () => {
  it.each([
    ['React  Native', 'React Native'],
    [' React ', 'React'],
    ['React\tNative', 'React Native'],
    ['React Native', 'React Native'],
    ['React Native', 'React Native'],
    ['　Go', 'Go'],
    ['Go\n', 'Go'],
    ['Café', 'Café'],
    ['C#', 'C#'],
    ['Ծրագրավորում', 'Ծրագրավորում'],
  ])('%j -> %j', (input, output) => {
    expect(normalizeTerm(input)).toBe(output);
  });

  it('keeps case: the stored spelling is canonicalized against the database', () => {
    expect(normalizeTerm('react')).toBe('react');
  });
});

describe('term', () => {
  it('rejects empty and over-long names', () => {
    expect(term.safeParse('   ').success).toBe(false);
    expect(term.safeParse('😀'.repeat(255)).success).toBe(true);
    expect(term.safeParse('😀'.repeat(256)).success).toBe(false);
  });
});

describe('termList', () => {
  it('normalizes and drops case-insensitive duplicates, keeping the first', () => {
    expect(termList({ maxItems: 10 }).parse(['React', ' react ', 'REACT', 'Go'])).toEqual([
      'React',
      'Go',
    ]);
  });
  it('caps the count', () => {
    expect(termList({ maxItems: 1 }).safeParse(['a', 'b']).success).toBe(false);
  });
});
