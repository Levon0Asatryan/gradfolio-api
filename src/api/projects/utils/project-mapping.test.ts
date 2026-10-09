import { describe, expect, it } from 'vitest';
import type { ProjectDetailRow, ProjectSummaryRow } from '../repositories/project.repository.js';
import { toDetail, toSummary } from './project-mapping.js';

const base = {
  id: 'p1',
  userId: 'owner',
  title: 'T',
  summary: null,
  category: 'other',
  status: 'ongoing',
  heroImageUrl: null,
  isPublic: true,
  isDraft: false,
  metaStartDate: '2025-01-02',
  metaEndDate: null,
  metaCourse: null,
  metaProfessor: null,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  updatedAt: new Date('2026-01-02T10:00:00Z'),
} as unknown as ProjectSummaryRow;

const detailRow = {
  ...base,
  aiSummary: null,
  descriptionHtml: null,
  liveDemoUrl: null,
  links: null,
  files: null,
  source: 'manual',
  repoUrl: null,
  repoLatestCommit: null,
  repoReadmeUrl: null,
  repoStars: null,
  repoForks: null,
  repoLanguage: null,
  ownerName: 'Owner',
  ownerAvatarUrl: 'https://img.example/o.png',
  ownerIsPublic: false,
} as unknown as ProjectDetailRow;

const none = { attachments: [], team: [], tags: [], technologies: [] };

describe('toSummary', () => {
  it('flags the owner only for the owning viewer, and writes ISO UTC dates', () => {
    const terms = { tags: ['a'], technologies: ['b'] };
    expect(toSummary(base, terms, 'owner')).toMatchObject({
      isOwner: true,
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-02T10:00:00.000Z',
      metadata: { startDate: '2025-01-02', endDate: null },
      tags: ['a'],
      technologies: ['b'],
    });
    expect(toSummary(base, terms, 'someone').isOwner).toBe(false);
    expect(toSummary(base, terms, undefined).isOwner).toBe(false);
  });
});

describe('toDetail', () => {
  it('turns null JSON lists into empty ones', () => {
    const d = toDetail(detailRow, none, undefined, []);
    expect(d.links).toEqual([]);
    expect(d.files).toEqual([]);
  });

  it('hides the avatar of a private-profile owner from everyone but the owner', () => {
    expect(toDetail(detailRow, none, undefined, []).owner.avatarUrl).toBeNull();
    expect(toDetail(detailRow, none, 'other', []).owner.avatarUrl).toBeNull();
    expect(toDetail(detailRow, none, 'owner', []).owner.avatarUrl).toBe(
      'https://img.example/o.png',
    );
  });

  it('keeps a team member’s photo and link only while their profile is visible', () => {
    const member = (over: object) => ({
      id: 'm',
      name: 'N',
      role: null,
      avatarUrl: 'https://img.example/m.png',
      userId: 'u',
      memberVisible: true,
      ...over,
    });
    const team = toDetail(
      detailRow,
      {
        ...none,
        team: [
          member({}),
          member({ memberVisible: false }),
          member({ userId: null, memberVisible: false }),
        ],
      },
      undefined,
      [],
    ).team;
    expect(team.map((m) => [m.userId, m.avatarUrl])).toEqual([
      ['u', 'https://img.example/m.png'],
      [null, null],
      [null, 'https://img.example/m.png'], // an account that is gone: the row keeps its own copy
    ]);
  });

  it('embeds only videos on allowed hosts and keeps a stored thumbnail', () => {
    const att = (type: 'video' | 'image', url: string, thumbnailUrl: string | null = null) => ({
      id: url,
      type,
      url,
      title: null,
      thumbnailUrl,
    });
    const out = toDetail(
      detailRow,
      {
        ...none,
        attachments: [
          att('video', 'https://youtu.be/dQw4w9WgXcQ'),
          att('video', 'https://youtu.be/dQw4w9WgXcQ', 'https://img.example/t.png'),
          att('video', 'https://evil.example/x'),
          att('image', 'https://youtu.be/dQw4w9WgXcQ'),
        ],
      },
      undefined,
      ['youtu.be'],
    ).attachments;
    expect(out.map((a) => [a.embedUrl !== null, a.thumbnailUrl])).toEqual([
      [true, 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'],
      [true, 'https://img.example/t.png'],
      [false, null],
      [false, null],
    ]);
  });
});
