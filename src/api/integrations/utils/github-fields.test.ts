import { describe, expect, it } from 'vitest';
import type { GithubRepo } from '../../../core/github/github-client.js';
import {
  cutBytes,
  cutChars,
  descriptionOf,
  fieldsOf,
  hashField,
  mapLimit,
  SYNCED_FIELDS,
} from './github-fields.js';

const repo: GithubRepo = {
  id: 1,
  name: 'tracker',
  fullName: 'ani-p/tracker',
  description: '  Tracks things  ',
  language: 'Python',
  topics: [],
  stars: 1,
  forks: 0,
  htmlUrl: 'https://github.com/ani-p/tracker',
  private: false,
  fork: false,
  archived: false,
  defaultBranch: 'main',
  pushedAt: null,
  ownerId: 5,
  ownerLogin: 'ani-p',
  canPush: true,
};

describe('cutting', () => {
  it('cuts on code points and on bytes, never in the middle of one', () => {
    expect(cutChars('abc', 5)).toBe('abc');
    expect(cutChars('😀😀😀', 2)).toBe('😀😀');
    expect(cutBytes('abc', 10)).toBe('abc');
    expect(cutBytes('😀😀', 5)).toBe('😀');
    expect(cutBytes('aé', 2)).toBe('a');
  });
});

describe('what a README becomes', () => {
  const readme = (html: string) => ({ html, path: 'README.md' });
  it('none is null; too large is left out with a note', () => {
    expect(descriptionOf(repo, null, 1000)).toEqual({ html: null });
    expect(descriptionOf(repo, 'too_large', 1000)).toEqual({
      html: undefined,
      note: 'README_TOO_LARGE',
    });
  });
  it('blank is null; over the limit is left out, never cut; otherwise sanitized HTML', () => {
    expect(descriptionOf(repo, readme('<img src="a.png">'), 1000)).toEqual({ html: null });
    expect(descriptionOf(repo, readme(`<p>${'x'.repeat(50)}</p>`), 10)).toEqual({
      html: undefined,
      note: 'README_TOO_LARGE',
    });
    expect(descriptionOf(repo, readme('<h1>T</h1>'), 1000)).toEqual({ html: '<h2>T</h2>' });
  });
});

describe('fields and hashes', () => {
  it('fills the five synced fields from a repository', () => {
    expect(fieldsOf(repo, '<p>d</p>')).toEqual({
      title: 'tracker',
      summary: 'Tracks things',
      descriptionHtml: '<p>d</p>',
      repoUrl: 'https://github.com/ani-p/tracker',
      technologies: ['Python'],
    });
    expect(
      Object.keys(fieldsOf({ ...repo, description: null, language: null }, null)),
    ).toHaveLength(SYNCED_FIELDS.length);
    expect(fieldsOf({ ...repo, description: '   ' }, null).summary).toBeNull();
    expect(fieldsOf({ ...repo, language: null }, null).technologies).toEqual([]);
  });

  it('hashes by field, and technologies as a case-insensitive set', () => {
    expect(hashField('title', 'a')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashField('title', 'a')).not.toBe(hashField('summary', 'a'));
    expect(hashField('technologies', ['Go', 'Python'])).toBe(
      hashField('technologies', ['python', 'GO']),
    );
    expect(hashField('summary', null)).not.toBe(hashField('summary', ''));
  });
});

describe('mapLimit', () => {
  it('keeps the order, runs at most `limit` at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setImmediate(r));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
    expect(await mapLimit([], 3, (n: number) => Promise.resolve(n))).toEqual([]);
  });
});
