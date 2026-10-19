import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import type { DB } from '../../../core/db/types.generated.js';
import { ValidationError } from '../../../core/errors/app-error.js';
import type { GithubAccessToken } from '../../../core/github/github-access-token.js';
import type { GithubClient } from '../../../core/github/github-client.js';
import { createEducationSchema, createExperienceSchema } from '../../profiles/dto/section.dto.js';
import { educationSection } from '../../profiles/repositories/education.repository.js';
import { experienceSection } from '../../profiles/repositories/experience.repository.js';
import { SectionService } from '../../profiles/services/section.service.js';
import type { AcceptOverrides } from '../dto/suggestion.dto.js';
import { heldEntries } from '../repositories/entry-names.repository.js';
import type { SuggestionRow } from '../repositories/suggestion.repository.js';
import {
  domainMatches,
  entriesToOffer,
  entryIsGone,
  sameName,
  type EducationEvidence,
  type HeldEntries,
  type UniversityConfig,
  type WantedEntry,
} from './education-rules.js';

export const isEntryKind = (kind: string): boolean =>
  kind === 'education.add' || kind === 'experience.add';

/** What the refresh decides about education and organisation suggestions. */
export interface EntryPlan {
  rows: WantedEntry[];
  /** Whether an open one the rules no longer want is withdrawn. */
  gone(row: SuggestionRow): boolean;
}

const EDUCATION_OVERRIDES = ['degree', 'field', 'startYear', 'endYear', 'description'] as const;
const EXPERIENCE_OVERRIDES = ['title', 'start', 'end', 'summary'] as const;

/**
 * Education and organisation suggestions (docs/modules/m7/plan.md §6.6f). GitHub is asked
 * only for what is configured, and only a refresh that reads GitHub asks: at most one
 * call for the emails, and, when organisations are configured, two for them (who the
 * token is, then that login's public organisations). Nothing it reads is stored: an
 * address is compared inside the GitHub client and dropped, and of the student's
 * organisations only the configured ones are kept, for the length of the refresh.
 */
@Injectable()
export class EducationSuggestionsService {
  private readonly university: UniversityConfig;

  constructor(
    private readonly sections: SectionService,
    @Inject(APP_CONFIG) cfg: AppConfig,
  ) {
    this.university = {
      domains: cfg.UNIVERSITY_DOMAINS,
      name: cfg.UNIVERSITY_NAME,
      orgs: cfg.UNIVERSITY_ORGS,
    };
  }

  private get emailsConfigured(): boolean {
    return this.university.domains.length > 0 && this.university.name !== undefined;
  }

  private get orgsConfigured(): boolean {
    return Object.keys(this.university.orgs).length > 0;
  }

  /** What GitHub shows, outside any transaction. `undefined`: nothing is configured. */
  async read(
    github: GithubClient,
    token: GithubAccessToken,
  ): Promise<EducationEvidence | undefined> {
    if (!this.emailsConfigured && !this.orgsConfigured) return undefined;
    let institutionVerified: boolean | undefined;
    if (this.emailsConfigured) {
      // `null`: the token cannot see emails, which proves nothing either way.
      institutionVerified =
        (await github.hasVerifiedEmail(token, (a) => domainMatches(a, this.university.domains))) ??
        undefined;
    }
    let orgLogins: string[] | undefined;
    if (this.orgsConfigured) {
      const { login } = await github.authenticatedUser(token);
      const all = await github.listPublicOrgLogins(token, login);
      orgLogins = all.filter((l) => Object.hasOwn(this.university.orgs, l));
    }
    return { institutionVerified, orgLogins };
  }

  /** In the refresh's transaction: the rows wanted, and which open ones to withdraw. */
  async plan(
    trx: Transaction<DB>,
    userId: string,
    evidence: EducationEvidence | undefined,
    githubOk: boolean,
  ): Promise<EntryPlan> {
    const held = await heldEntries(trx, userId);
    const seen = githubOk ? evidence : undefined;
    const rows = seen === undefined ? [] : entriesToOffer(seen, this.university, held);
    // Not connected: there is no evidence, which is known. Connected but not asked (inside
    // the floor, or the emails not shown to the token): what GitHub showed is not known.
    const known = {
      institution: !githubOk || seen?.institutionVerified !== undefined,
      organizations: !githubOk || seen?.orgLogins !== undefined,
    };
    return {
      rows,
      gone: (row) =>
        entryIsGone({ kind: row.kind, payload: row.payload ?? {} }, this.university, held, known),
    };
  }

  /**
   * Accept, in the caller's transaction under the user lock. The name comes from the
   * suggestion, the rest from `overrides` (a degree, field and years are the student's to
   * give). `stale`: the profile holds an entry for it now, or the configuration no longer
   * offers it; nothing is written and the caller supersedes the suggestion.
   */
  async applyIn(
    trx: Transaction<DB>,
    userId: string,
    row: SuggestionRow,
    overrides: AcceptOverrides | undefined,
  ): Promise<{ kind: 'done'; applied: { field: string; value: string } } | { kind: 'stale' }> {
    const stored = (row.payload ?? {}) as { value?: unknown };
    const name = typeof stored.value === 'string' ? stored.value : '';
    const education = row.kind === 'education.add';
    const held: HeldEntries = await heldEntries(trx, userId);
    const offered = education
      ? this.university.name !== undefined && sameName(this.university.name, name)
      : Object.values(this.university.orgs).some((n) => sameName(n, name));
    const exists = (education ? held.institutions : held.organizations).some((h) =>
      sameName(h, name),
    );
    if (!offered || exists) return { kind: 'stale' };

    const allowed: readonly string[] = education ? EDUCATION_OVERRIDES : EXPERIENCE_OVERRIDES;
    const given = Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined);
    const misplaced = given.filter(([k]) => !allowed.includes(k));
    if (misplaced.length > 0) {
      throw new ValidationError(
        misplaced.map(([k]) => ({
          path: `overrides.${k}`,
          message: 'does not apply to this suggestion',
        })),
      );
    }
    const values = Object.fromEntries(given);
    const fail = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
      new ValidationError(
        issues.map((i) => ({
          path: ['overrides', ...i.path.map(String)].join('.'),
          message: i.message,
        })),
      );
    if (education) {
      const parsed = createEducationSchema.safeParse({ institution: name, ...values });
      if (!parsed.success) throw fail(parsed.error.issues);
      await this.sections.createIn(trx, educationSection, userId, parsed.data);
    } else {
      const parsed = createExperienceSchema.safeParse({
        organization: name,
        summary: '',
        ...values,
      });
      if (!parsed.success) throw fail(parsed.error.issues);
      await this.sections.createIn(trx, experienceSection, userId, parsed.data);
    }
    return {
      kind: 'done',
      applied: { field: education ? 'education' : 'experience', value: name },
    };
  }
}
