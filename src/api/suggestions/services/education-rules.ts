import { createHash } from 'node:crypto';
import type { SuggestionKind } from '../dto/suggestion.dto.js';

/**
 * Education and organisation suggestions (docs/modules/m7/plan.md §6.6f): pure rules, no
 * I/O. An institution is offered when the student has a **verified** GitHub address on a
 * configured domain; an organisation when the student's public memberships include a
 * configured one. Either is offered only to an empty state: not when the profile already
 * holds an entry for that institution or organisation. No address is handled here: the
 * GitHub client compares it and keeps nothing (`hasVerifiedEmail`).
 */

export interface UniversityConfig {
  domains: readonly string[];
  name: string | undefined;
  /** Lower-case GitHub login -> the name offered as the organisation. */
  orgs: Readonly<Record<string, string>>;
}

/** What GitHub showed this refresh. `undefined`: not asked, or not shown to this token. */
export interface EducationEvidence {
  institutionVerified: boolean | undefined;
  /** The configured organisations among the student's public memberships (logins). */
  orgLogins: string[] | undefined;
}

/** What the profile already holds. */
export interface HeldEntries {
  institutions: readonly string[];
  organizations: readonly string[];
}

export interface WantedEntry {
  kind: Extract<SuggestionKind, 'education.add' | 'experience.add'>;
  dedupeKey: string;
  /** `{field, value}` like a profile suggestion: the section and the name it would add. */
  payload: { field: 'education' | 'experience'; value: string };
}

/**
 * Whether `address` is on `domain` or a subdomain of it: the part after the **last**
 * `@`, compared case-insensitively, as a whole label sequence. `evilpolytechnic.am`
 * and `polytechnic.am.evil.com` are not on `polytechnic.am`.
 */
export function domainMatches(address: string, domains: readonly string[]): boolean {
  const at = address.lastIndexOf('@');
  if (at <= 0) return false;
  const host = address.slice(at + 1).toLowerCase();
  // An empty label (`.polytechnic.am`, `a..polytechnic.am`, a trailing dot) is not a host.
  if (host.split('.').includes('')) return false;
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Names compare without case, accents-as-composed and runs of spaces. */
export const foldName = (s: string): string =>
  s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export const sameName = (a: string, b: string): boolean => foldName(a) === foldName(b);

const holds = (held: readonly string[], name: string): boolean =>
  held.some((h) => sameName(h, name));

export const educationKey = (name: string): string =>
  `education:${createHash('sha256').update(foldName(name)).digest('hex').slice(0, 16)}`;

/** The name is in the key: a renamed organisation is a new offer, and the old row is withdrawn. */
export const organizationKey = (login: string, name: string): string =>
  `experience:org:${login.toLowerCase()}:${createHash('sha256').update(foldName(name)).digest('hex').slice(0, 8)}`;

/** The entries to offer, an institution first, then organisations in the config's order. */
export function entriesToOffer(
  evidence: EducationEvidence,
  cfg: UniversityConfig,
  held: HeldEntries,
): WantedEntry[] {
  const wanted: WantedEntry[] = [];
  if (
    evidence.institutionVerified === true &&
    cfg.name !== undefined &&
    !holds(held.institutions, cfg.name)
  ) {
    wanted.push({
      kind: 'education.add',
      dedupeKey: educationKey(cfg.name),
      payload: { field: 'education', value: cfg.name },
    });
  }
  const seen = new Set(evidence.orgLogins ?? []);
  for (const [login, name] of Object.entries(cfg.orgs)) {
    if (seen.has(login) && !holds(held.organizations, name)) {
      wanted.push({
        kind: 'experience.add',
        dedupeKey: organizationKey(login, name),
        payload: { field: 'experience', value: name },
      });
    }
  }
  return wanted;
}

/**
 * Whether an open suggestion the rules no longer want should be withdrawn. Kept while
 * GitHub was not asked this time (inside the refresh floor) unless the profile holds the
 * entry now or the configuration no longer offers it; withdrawn when GitHub was asked and
 * no longer shows the evidence.
 */
export function entryIsGone(
  row: { kind: string; payload: { field?: unknown; value?: unknown } },
  cfg: UniversityConfig,
  held: HeldEntries,
  known: { institution: boolean; organizations: boolean },
): boolean {
  const name = typeof row.payload.value === 'string' ? row.payload.value : '';
  if (row.kind === 'education.add') {
    const offered = cfg.name !== undefined && sameName(cfg.name, name);
    return known.institution || !offered || holds(held.institutions, name);
  }
  const offered = Object.values(cfg.orgs).some((n) => sameName(n, name));
  return known.organizations || !offered || holds(held.organizations, name);
}
