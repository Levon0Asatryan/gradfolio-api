import { createHash } from 'node:crypto';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import type { GithubProfile } from '../../../core/github/github-client.js';
import { cutBytes, cutChars } from '../../integrations/utils/github-fields.js';
import { updateProfileSchema } from '../../profiles/dto/profile.dto.js';
import { FALLBACK_NAME, prefillFrom } from '../../users/utils/prefill.js';
import type { SuggestionKind } from '../dto/suggestion.dto.js';

/**
 * What the profile could take from GitHub and from the sign-in claims
 * (docs/m7-plan.md §6.2): pure rules, no I/O. A suggestion is offered only
 * when the field is empty or holds something else, and only for a value the
 * profile's own write rules (`updateProfileSchema`) accept, so an accept
 * cannot fail on validation.
 */

export type ProfileField =
  'name' | 'headline' | 'bio' | 'location' | 'avatarUrl' | 'links.github' | 'links.website';

/** The caller's profile fields as stored. */
export interface ProfileNow {
  name: string;
  headline: string;
  bio: string | null;
  location: string | null;
  avatarUrl: string | null;
  github: string | null;
  website: string | null;
}

export interface Wanted {
  kind: SuggestionKind;
  source: 'github' | 'linkedin';
  field: ProfileField;
  value: string;
  mode: 'fill' | 'replace';
  dedupeKey: string;
}

const KIND: Record<ProfileField, SuggestionKind> = {
  name: 'profile.name',
  headline: 'profile.headline',
  bio: 'profile.bio',
  location: 'profile.location',
  avatarUrl: 'profile.avatarUrl',
  'links.github': 'profile.links.github',
  'links.website': 'profile.links.website',
};

export const currentOf = (now: ProfileNow, field: ProfileField): string | null => {
  const v = {
    name: now.name,
    headline: now.headline,
    bio: now.bio,
    location: now.location,
    avatarUrl: now.avatarUrl,
    'links.github': now.github,
    'links.website': now.website,
  }[field];
  return v === null || v.trim() === '' ? null : v;
};

/** The PATCH body that would write `value` to `field`. */
export function patchOf(field: ProfileField, value: string): Record<string, unknown> {
  return field.startsWith('links.')
    ? { links: { [field.slice('links.'.length)]: value } }
    : { [field]: value };
}

export const valueHash = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);

/** `example.com` is a website; GitHub stores `blog` as typed. */
function withScheme(blog: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(blog) ? blog : `https://${blog}`;
}

function candidate(
  source: Wanted['source'],
  field: ProfileField,
  raw: string | null | undefined,
  now: ProfileNow,
  { fillOnly = false }: { fillOnly?: boolean } = {},
): Wanted | undefined {
  const value = raw?.trim();
  if (value === undefined || value === '') return undefined;
  const current = currentOf(now, field);
  if (current !== null && current === value) return undefined;
  if (current !== null && fillOnly) return undefined;
  // The write's own rules: a value they refuse is never offered.
  if (!updateProfileSchema.safeParse(patchOf(field, value)).success) return undefined;
  return {
    kind: KIND[field],
    source,
    field,
    value,
    mode: current === null ? 'fill' : 'replace',
    dedupeKey: `profile:${field}:${source}:${valueHash(value)}`,
  };
}

/** GitHub's public profile against the caller's: bio, location, company, avatar, links. */
export function fromGithubProfile(profile: GithubProfile, now: ProfileNow): Wanted[] {
  const company = profile.company?.trim().replace(/^@+/, '');
  const found = [
    candidate('github', 'name', profile.name === null ? null : cutChars(profile.name, 255), now),
    candidate('github', 'bio', profile.bio === null ? null : cutBytes(profile.bio, 60_000), now),
    candidate(
      'github',
      'location',
      profile.location === null ? null : cutChars(profile.location, 255),
      now,
    ),
    // A company is not a headline: offered only to an empty one, to be edited.
    candidate('github', 'headline', company === undefined ? null : cutChars(company, 500), now, {
      fillOnly: true,
    }),
    candidate('github', 'avatarUrl', profile.avatarUrl, now),
    candidate('github', 'links.github', profile.htmlUrl, now),
    candidate(
      'github',
      'links.website',
      profile.blog === null || profile.blog.trim() === '' ? null : withScheme(profile.blog.trim()),
      now,
    ),
  ];
  return found.filter((w): w is Wanted => w !== undefined);
}

/** A LinkedIn sign-in's name and photo, when they are not what the profile holds. */
export function fromLinkedinClaims(identity: AccessTokenIdentity, now: ProfileNow): Wanted[] {
  if (!identity.sub.startsWith('linkedin|')) return [];
  const claimed = prefillFrom(identity);
  const found = [
    // No usable name in the claims is the prefill's placeholder, never a suggestion.
    candidate('linkedin', 'name', claimed.name === FALLBACK_NAME ? null : claimed.name, now),
    candidate('linkedin', 'avatarUrl', claimed.avatarUrl, now),
  ];
  return found.filter((w): w is Wanted => w !== undefined);
}

/** `2026-Q4`, UTC: one reminder per quarter. */
export const quarterOf = (at: Date): string =>
  `${at.getUTCFullYear()}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
