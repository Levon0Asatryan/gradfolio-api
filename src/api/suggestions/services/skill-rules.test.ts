import { describe, expect, it } from 'vitest';
import {
  type EvidenceItem,
  MAX_SKILL_SUGGESTIONS,
  SKILL_MIN_EVIDENCE,
  skillDedupeKey,
  skillsToOffer,
} from './skill-rules.js';

const repo = (id: number, ...names: string[]): EvidenceItem => ({
  id: `repo:${id}`,
  from: 'repository',
  names,
});
const project = (id: string, repoId: number | null, ...names: string[]): EvidenceItem => ({
  id: repoId === null ? `project:${id}` : `repo:${repoId}`,
  from: 'project',
  names,
});
const offered = (items: EvidenceItem[], have: string[] = []) =>
  skillsToOffer(items, have).map((w) => w.name);

describe('skills to offer', () => {
  it('needs at least two items: the threshold is a constant of two', () => {
    expect(SKILL_MIN_EVIDENCE).toBe(2);
    expect(offered([repo(1, 'TypeScript')])).toEqual([]);
    expect(offered([repo(1, 'TypeScript'), repo(2, 'TypeScript')])).toEqual(['TypeScript']);
    expect(offered([repo(1, 'TypeScript'), repo(2, 'Go'), repo(3, 'TypeScript')])).toEqual([
      'TypeScript',
    ]);
  });

  it('counts a name once per item, whatever its case or how often the item lists it', () => {
    expect(offered([repo(1, 'TypeScript', 'typescript', 'TYPESCRIPT')])).toEqual([]);
    expect(offered([repo(1, 'Docker', 'docker'), repo(2, 'docker')])).toEqual(['Docker']);
  });

  it('offers nothing the profile has, whatever the case or spacing', () => {
    const items = [repo(1, 'TypeScript'), repo(2, 'TypeScript')];
    expect(offered(items, ['typescript'])).toEqual([]);
    expect(offered(items, ['  TYPESCRIPT '])).toEqual([]);
    expect(offered(items, ['JavaScript'])).toEqual(['TypeScript']);
  });

  it('counts a project imported from a repository, and the repository, as one item', () => {
    expect(offered([repo(7, 'Python'), project('p1', 7, 'Python')])).toEqual([]);
    expect(offered([repo(7, 'Python'), project('p1', 7, 'Python'), repo(8, 'Python')])).toEqual([
      'Python',
    ]);
  });

  it('adds a repository and a project that is not from one', () => {
    const [w] = skillsToOffer([repo(1, 'Docker'), project('p1', null, 'Docker')], []);
    expect(w).toMatchObject({ name: 'Docker', evidence: 2, repositories: 1, projects: 1 });
  });

  it('keeps the first spelling and the best evidenced first, at most the cap', () => {
    const items = [
      repo(1, 'TypeScript', 'react'),
      repo(2, 'typescript', 'React', 'go'),
      repo(3, 'TypeScript', 'go'),
    ];
    expect(offered(items)).toEqual(['TypeScript', 'go', 'react']);
    const many = (id: number) => repo(id, ...Array.from({ length: 15 }, (_, i) => `skill-${i}`));
    expect(offered([many(1), many(2)])).toHaveLength(MAX_SKILL_SUGGESTIONS);
  });

  it('keys a skill by its normalised name, and skips a name too long for the key', () => {
    expect(skillDedupeKey('  Node   JS ')).toBe('skill:node js');
    const long = 'x'.repeat(200);
    expect(offered([repo(1, long), repo(2, long)])).toEqual([]);
  });
});
