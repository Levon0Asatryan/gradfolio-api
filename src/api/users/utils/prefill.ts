import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { isHttpUrl } from '../../../core/validation/http-url.js';
import { COLUMN_LIMITS } from '../../../core/validation/columns.js';
import { fits } from '../../../core/validation/text.js';

/** What a new user's row starts with, from the token's profile claims. */
export interface UserPrefill {
  name: string;
  email: string | null;
  avatarUrl: string | null;
  headline: string;
  verified: boolean;
}

/** The name used when the token carries neither a name nor an email. */
export const FALLBACK_NAME = 'Gradfolio user';

/** At most `max` code points: VARCHAR counts characters, not UTF-16 units. */
function cut(value: string, max: number): string {
  const points = [...value];
  return points.length <= max ? value : points.slice(0, max).join('');
}

/** The trimmed value, or undefined when it is missing or blank. */
function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** `someone@host`: no spaces, one `@` with text on both sides. */
const looksLikeEmail = (value: string | undefined): boolean =>
  value !== undefined && /^[^\s@]+@[^\s@]+$/u.test(value.trim());

const NAME_MAX = 255; // users.name VARCHAR(255)
const HEADLINE_MAX = 500; // users.headline VARCHAR(500)

/**
 * Pre-fill rules (docs/m2-plan.md §3.4). Data from an identity provider is cut
 * or dropped, never rejected: a login must not fail because a provider sent a
 * 300-character name or an odd picture URL.
 */
export function prefillFrom(identity: AccessTokenIdentity): UserPrefill {
  const email =
    identity.email !== undefined &&
    identity.email.includes('@') &&
    fits(identity.email, COLUMN_LIMITS['users.email'])
      ? identity.email
      : null;

  // An Auth0 database login's `name` claim *is* the email address. Used as is,
  // it would publish the login email as the display name on a public profile
  // (found with a real database-login token, docs/m3-verification.md §7), so a
  // name that is an email address counts as no name: the local part is used.
  const claimedName = looksLikeEmail(identity.name) ? undefined : nonBlank(identity.name);
  const name = claimedName ?? nonBlank(email?.slice(0, email.indexOf('@'))) ?? FALLBACK_NAME;

  const avatarUrl =
    identity.picture !== undefined &&
    isHttpUrl(identity.picture) &&
    fits(identity.picture, COLUMN_LIMITS['users.avatar_url'])
      ? identity.picture
      : null;

  // LinkedIn's sign-in does not provide a headline (m2-plan §8.2); one is used
  // only if a LinkedIn identity ever carries it.
  const headline =
    identity.sub.startsWith('linkedin|') && identity.headline !== undefined
      ? cut(identity.headline.trim(), HEADLINE_MAX)
      : '';

  return {
    name: cut(name, NAME_MAX),
    email,
    avatarUrl,
    headline,
    verified: identity.emailVerified,
  };
}

/** Whether the token carries any profile claim (the Action ran). */
export function hasProfileClaims(identity: AccessTokenIdentity): boolean {
  return (
    identity.email !== undefined || identity.name !== undefined || identity.picture !== undefined
  );
}
