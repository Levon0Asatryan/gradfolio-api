import { describe, expect, it } from 'vitest';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import type { GithubProfile } from '../../../core/github/github-client.js';
import {
  currentOf,
  fromGithubProfile,
  fromLinkedinClaims,
  patchOf,
  type ProfileNow,
  quarterOf,
  valueHash,
} from './profile-rules.js';

const empty: ProfileNow = {
  name: 'Ani Petrosyan',
  headline: '',
  bio: null,
  location: null,
  avatarUrl: null,
  github: null,
  website: null,
};
const gh: GithubProfile = {
  name: 'Ani P.',
  bio: 'Builds things',
  location: 'Yerevan',
  company: '@NPUA',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  blog: 'ani.example.am',
  htmlUrl: 'https://github.com/ani-p',
};
const byField = (ws: ReturnType<typeof fromGithubProfile>) =>
  Object.fromEntries(ws.map((w) => [w.field, w]));

describe('GitHub profile to suggestions', () => {
  it('fills every empty field, with a scheme for a bare blog and without the @ of a company', () => {
    const w = byField(fromGithubProfile(gh, empty));
    expect(Object.keys(w).sort()).toEqual(
      ['avatarUrl', 'bio', 'headline', 'links.github', 'links.website', 'location', 'name'].sort(),
    );
    expect(w['links.website']).toMatchObject({ value: 'https://ani.example.am', mode: 'fill' });
    expect(w.headline).toMatchObject({ value: 'NPUA', mode: 'fill' });
    expect(w.bio).toMatchObject({ kind: 'profile.bio', source: 'github', mode: 'fill' });
  });

  it('offers a replacement only when the value differs, and nothing when it is equal', () => {
    const now: ProfileNow = {
      ...empty,
      bio: 'Builds things',
      location: 'Gyumri',
      avatarUrl: null,
    };
    const w = byField(fromGithubProfile(gh, now));
    expect(w.bio).toBeUndefined();
    expect(w.location).toMatchObject({ value: 'Yerevan', mode: 'replace' });
  });

  it('never replaces a headline with a company', () => {
    const w = byField(fromGithubProfile(gh, { ...empty, headline: 'CS undergraduate' }));
    expect(w.headline).toBeUndefined();
  });

  it('skips blank GitHub values and values the profile’s write rules refuse', () => {
    const w = fromGithubProfile(
      {
        ...gh,
        name: null,
        bio: '   ',
        location: null,
        company: null,
        blog: 'not a url ::',
        avatarUrl: 'javascript:alert(1)',
      },
      empty,
    );
    expect(w.map((x) => x.field)).toEqual(['links.github']);
  });

  it('keys a suggestion by field, source and the value’s hash: a new value is a new key', () => {
    const a = fromGithubProfile(gh, empty).find((w) => w.field === 'bio')!;
    const b = fromGithubProfile({ ...gh, bio: 'Something else' }, empty).find(
      (w) => w.field === 'bio',
    )!;
    expect(a.dedupeKey).toBe(`profile:bio:github:${valueHash('Builds things')}`);
    expect(b.dedupeKey).not.toBe(a.dedupeKey);
    expect(valueHash('x')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('LinkedIn sign-in claims', () => {
  const identity = (over: Partial<AccessTokenIdentity>): AccessTokenIdentity => ({
    sub: 'linkedin|abc',
    emailVerified: false,
    identities: ['linkedin'],
    ...over,
  });

  it('suggests a changed name and photo for a LinkedIn sign-in only', () => {
    const w = fromLinkedinClaims(
      identity({ name: 'Ani P.', picture: 'https://media.licdn.com/p.jpg' }),
      empty,
    );
    expect(w.map((x) => [x.field, x.source, x.mode])).toEqual([
      ['name', 'linkedin', 'replace'],
      ['avatarUrl', 'linkedin', 'fill'],
    ]);
    expect(fromLinkedinClaims(identity({ sub: 'google-oauth2|1', name: 'X' }), empty)).toEqual([]);
  });

  it('offers nothing when the claims are what the profile holds, or an email as a name', () => {
    expect(fromLinkedinClaims(identity({ name: 'Ani Petrosyan' }), empty)).toEqual([]);
    // No usable name (an email-shaped one, no email claim): the placeholder is not offered.
    expect(fromLinkedinClaims(identity({ name: 'ani@example.com' }), empty)).toEqual([]);
    expect(fromLinkedinClaims(identity({}), empty)).toEqual([]);
    // With the email claim, the local part is what prefill makes of it.
    const w = fromLinkedinClaims(
      identity({ name: 'ani@example.com', email: 'ani@example.com' }),
      empty,
    );
    expect(w.map((x) => x.value)).toEqual(['ani']);
  });
});

describe('helpers', () => {
  it('currentOf treats blank as empty, patchOf nests links', () => {
    expect(currentOf({ ...empty, bio: '  ' }, 'bio')).toBeNull();
    expect(currentOf({ ...empty, github: 'https://github.com/x' }, 'links.github')).toBe(
      'https://github.com/x',
    );
    expect(patchOf('links.website', 'https://x.am')).toEqual({
      links: { website: 'https://x.am' },
    });
    expect(patchOf('bio', 'b')).toEqual({ bio: 'b' });
  });

  it('quarterOf is UTC', () => {
    expect(quarterOf(new Date('2026-01-01T00:00:00Z'))).toBe('2026-Q1');
    expect(quarterOf(new Date('2026-12-31T23:59:59Z'))).toBe('2026-Q4');
  });
});
