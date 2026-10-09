import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_REGISTRY,
  type ActivityKey,
  checkActivity,
  InvalidActivityError,
} from './activity-registry.js';

describe('the activity registry', () => {
  it('accepts exactly the declared parameters and reports the declared type', () => {
    expect(checkActivity('projectCreated', { projectId: 'p', name: 'Gradfolio' })).toEqual({
      type: 'project',
      params: { projectId: 'p', name: 'Gradfolio' },
    });
    expect(checkActivity('newSkill', { skill: 'Docker' })).toEqual({
      type: 'profile',
      params: { skill: 'Docker' },
    });
    expect(checkActivity('skillsAdded', { count: 3 }).params).toEqual({ count: 3 });
  });

  it.each([
    [
      'an extra key (nothing private rides along)',
      'projectCreated',
      { projectId: 'p', name: 'n', descriptionHtml: '<p>x</p>' },
    ],
    ['a missing key', 'teamLeft', { projectId: 'p', name: 'n' }],
    ['an empty name', 'projectCreated', { projectId: 'p', name: '' }],
    ['a name over the column length', 'newSkill', { skill: 'x'.repeat(256) }],
    ['a count of one (that is newSkill)', 'skillsAdded', { count: 1 }],
    ['a fractional count', 'skillsAdded', { count: 2.5 }],
    ['a number where a name belongs', 'newSkill', { skill: 7 }],
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
  const base = { projectId: 'p', name: 'n', member: 'm' };
  if (key === 'newSkill') return { skill: 's' };
  if (key === 'skillsAdded') return { count: 2 };
  if (key === 'projectDeleted') return { name: 'n' };
  if (key === 'projectCreated' || key === 'projectPublished' || key === 'teamJoined') {
    return { projectId: 'p', name: 'n' };
  }
  return base;
}
