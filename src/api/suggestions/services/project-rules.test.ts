import { describe, expect, it } from 'vitest';
import type { GithubRepo } from '../../../core/github/github-client.js';
import { hashField } from '../../../core/github/snapshot.js';
import {
  isOffered,
  isUpdateStale,
  mayHaveChanged,
  newRepoRows,
  type ProjectNow,
  PUSH_MARGIN_MS,
  updateKey,
  updateRows,
} from './project-rules.js';

const repo = (id: number, over: Partial<GithubRepo> = {}): GithubRepo => ({
  id,
  name: `r${id}`,
  fullName: `me/r${id}`,
  description: null,
  language: null,
  topics: [],
  stars: 0,
  forks: 0,
  htmlUrl: `https://github.com/me/r${id}`,
  private: false,
  fork: false,
  archived: false,
  defaultBranch: 'main',
  pushedAt: null,
  ownerId: 7,
  ownerLogin: 'me',
  canPush: true,
  ...over,
});

const project = (over: Partial<ProjectNow> = {}): ProjectNow => ({
  projectId: 'p1',
  title: 'T',
  summary: 'old summary',
  descriptionHtml: '<p>old</p>',
  snapshot: {
    summary: hashField('summary', 'old summary'),
    descriptionHtml: hashField('descriptionHtml', '<p>old</p>'),
  },
  ...over,
});

describe('isOffered', () => {
  it('is the one test of the offer, the refresh and the accept: own, public, not a fork, not archived', () => {
    expect(isOffered(repo(1), 7)).toBe(true);
    expect(isOffered(repo(1, { archived: true }), 7)).toBe(false);
    expect(isOffered(repo(1, { private: true }), 7)).toBe(false);
    expect(isOffered(repo(1, { fork: true }), 7)).toBe(false);
    // Push access is enough to import, not to be offered.
    expect(isOffered(repo(1, { ownerId: 99, canPush: true }), 7)).toBe(false);
  });
});

describe('newRepoRows', () => {
  it('offers own, public, live, not-imported repositories, newest first, at most `limit`', () => {
    const page = [
      repo(1),
      repo(2, { fork: true }),
      repo(3, { archived: true }),
      repo(4, { ownerId: 99, canPush: true }),
      repo(5),
      repo(6),
      repo(7),
    ];
    const rows = newRepoRows(page, 7, new Set([5]), 2);
    expect(rows.map((r) => r.dedupeKey)).toEqual(['repo:1:new', 'repo:6:new']);
    expect(rows[0]).toMatchObject({
      kind: 'project.new',
      targetId: null,
      payload: { repoId: 1, fullName: 'me/r1', name: 'r1' },
    });
  });

  it('offers nothing when the limit is 0', () => {
    expect(newRepoRows([repo(1)], 7, new Set(), 0)).toEqual([]);
  });
});

describe('updateRows', () => {
  const upstream = (values: Record<string, string | null>) =>
    new Map([['p1', { repoId: 10, fullName: 'me/r10', values }]]);

  it('offers a field GitHub changed while the project still holds what the import wrote', () => {
    const rows = updateRows(
      new Map([['p1', project()]]),
      upstream({ summary: 'new summary', descriptionHtml: '<p>new</p>' }),
    );
    expect(rows.map((r) => r.payload.field)).toEqual(['summary', 'descriptionHtml']);
    expect(rows[0]).toMatchObject({
      kind: 'project.update',
      targetId: 'p1',
      payload: {
        value: 'new summary',
        baseHash: hashField('summary', 'old summary'),
        repoId: 10,
        fullName: 'me/r10',
        title: 'T',
      },
    });
    expect(rows[0]!.dedupeKey).toBe(
      updateKey('p1', 'summary', hashField('summary', 'new summary')),
    );
  });

  it('offers nothing for a field the student edited, though GitHub changed it', () => {
    const rows = updateRows(
      new Map([['p1', project({ summary: 'my own words' })]]),
      upstream({ summary: 'new summary' }),
    );
    expect(rows).toEqual([]);
  });

  it('offers nothing when GitHub still says what the snapshot says, or was not read for the field', () => {
    const now = new Map([['p1', project()]]);
    expect(updateRows(now, upstream({ summary: 'old summary' }))).toEqual([]);
    expect(updateRows(now, upstream({}))).toEqual([]);
  });

  it('never proposes to clear a field, and skips a project without a snapshot or one that is gone', () => {
    expect(updateRows(new Map([['p1', project()]]), upstream({ summary: null }))).toEqual([]);
    expect(
      updateRows(new Map([['p1', project({ snapshot: {} })]]), upstream({ summary: 'x' })),
    ).toEqual([]);
    expect(updateRows(new Map(), upstream({ summary: 'x' }))).toEqual([]);
  });

  it('a new upstream value is a new key', () => {
    const a = updateRows(new Map([['p1', project()]]), upstream({ summary: 'a' }));
    const b = updateRows(new Map([['p1', project()]]), upstream({ summary: 'b' }));
    expect(a[0]!.dedupeKey).not.toBe(b[0]!.dedupeKey);
  });
});

describe('isUpdateStale', () => {
  const payload = { field: 'summary', baseHash: hashField('summary', 'old summary') };

  it('is not stale while the field and the snapshot are as they were', () => {
    expect(isUpdateStale(payload, project())).toBe(false);
  });

  it('is stale when the student edited the field, the snapshot moved, or the project is gone', () => {
    expect(isUpdateStale(payload, project({ summary: 'mine' }))).toBe(true);
    expect(
      isUpdateStale(payload, project({ snapshot: { summary: hashField('summary', 'x') } })),
    ).toBe(true);
    expect(isUpdateStale(payload, undefined)).toBe(true);
    expect(isUpdateStale({ field: 'title', baseHash: 'x' }, project())).toBe(true);
  });
});

describe('mayHaveChanged', () => {
  const synced = new Date('2026-10-01T12:00:00Z');
  it('reads a README only for a push at or after the snapshot, less a margin', () => {
    expect(mayHaveChanged('2026-10-02T00:00:00Z', synced)).toBe(true);
    expect(mayHaveChanged('2026-09-30T00:00:00Z', synced)).toBe(false);
    const edge = new Date(synced.getTime() - PUSH_MARGIN_MS).toISOString();
    expect(mayHaveChanged(edge, synced)).toBe(true);
    expect(
      mayHaveChanged(new Date(synced.getTime() - PUSH_MARGIN_MS - 1).toISOString(), synced),
    ).toBe(false);
  });

  it('reads when the push time is unknown or unreadable', () => {
    expect(mayHaveChanged(null, synced)).toBe(true);
    expect(mayHaveChanged('not a date', synced)).toBe(true);
  });
});
