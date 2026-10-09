import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_REGISTRY,
  type ActivityKey,
  checkActivity,
  InvalidActivityError,
} from './activity-registry.js';

describe('the activity registry', () => {
  it('accepts exactly the declared parameters and reports the declared type', () => {
    expect(checkActivity('projectCreated', { projectId: 'p', projectName: 'Gradfolio' })).toEqual({
      type: 'project',
      params: { projectId: 'p', projectName: 'Gradfolio' },
    });
    expect(checkActivity('newSkill', { skillName: 'Docker' })).toEqual({
      type: 'profile',
      params: { skillName: 'Docker' },
    });
  });

  it.each([
    [
      'an extra key (nothing private rides along)',
      'projectCreated',
      { projectId: 'p', projectName: 'n', descriptionHtml: '<p>x</p>' },
    ],
    ['a missing key', 'teamLeft', { projectId: 'p', projectName: 'n' }],
    ['an empty name', 'projectCreated', { projectId: 'p', projectName: '' }],
    ['a name over the column length', 'newSkill', { skillName: 'x'.repeat(256) }],
    [
      'the old placeholder names (plan §8 says projectName)',
      'projectCreated',
      { projectId: 'p', name: 'n' },
    ],
    ['a key the plan does not list', 'skillsAdded', { count: 2 }],
    ['a number where a name belongs', 'newSkill', { skillName: 7 }],
  ])('refuses %s', (_label, key, params) => {
    expect(() => checkActivity(key as ActivityKey, params as never)).toThrow(InvalidActivityError);
  });

  it('refuses a key that is not in the registry, including inherited object keys', () => {
    for (const key of ['nope', 'toString', '__proto__', 'constructor']) {
      expect(() => checkActivity(key as ActivityKey, {} as never)).toThrow(/unknown activity key/);
    }
  });

  it('declares only project and profile events, with strict parameters', () => {
    for (const [key, entry] of Object.entries(ACTIVITY_REGISTRY)) {
      expect(['project', 'profile'], key).toContain(entry.type);
      expect(
        entry.params.safeParse({ ...entry.params.parse(sample(key)), extra: 1 }).success,
        key,
      ).toBe(false);
    }
  });
});

function sample(key: string): unknown {
  const base = { projectId: 'p', projectName: 'n', memberName: 'm' };
  if (key === 'newSkill') return { skillName: 's' };
  if (key === 'projectDeleted') return { projectName: 'n' };
  if (key === 'projectCreated' || key === 'projectPublished' || key === 'teamJoined') {
    return { projectId: 'p', projectName: 'n' };
  }
  return base;
}
