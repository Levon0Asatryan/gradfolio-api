import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { lockUser } from '../../../core/db/user-lock.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { GithubNotLinkedError } from '../../../core/github/errors.js';
import type {
  GithubProfile,
  GithubRepo,
  GithubSocialAccount,
} from '../../../core/github/github-client.js';
import type { GithubAccessToken } from '../../../core/github/github-access-token.js';
import type { GithubClient } from '../../../core/github/github-client.js';
import { SkillsService } from '../../profiles/services/skills.service.js';
import { decodeTimeCursor, encodeTimeCursor } from '../../common/utils/time-cursor.js';
import { updateProfileSchema } from '../../profiles/dto/profile.dto.js';
import { ProfileService, type AvatarMemo } from '../../profiles/services/profile.service.js';
import { importedProjectIds } from '../../integrations/repositories/github-import.repository.js';
import { GithubConnectionService } from '../../integrations/services/github-connection.service.js';
import { insertSuggestionsNotification } from '../../notifications/repositories/notification-write.repository.js';
import type { UserRow } from '../../users/repositories/user.repository.js';
import type {
  AcceptOverrides,
  RefreshResponse,
  ResolveResponse,
  SuggestionKind,
  SuggestionPage,
  SuggestionQuery,
  SuggestionView,
} from '../dto/suggestion.dto.js';
import { EducationSuggestionsService, isEntryKind } from './education-suggestions.service.js';
import type { EducationEvidence } from './education-rules.js';
import { lockProjectStates } from '../repositories/project-change.repository.js';
import {
  claimRefresh,
  currentProfile,
  insertOpen,
  linkedinLastSynced,
  listSuggestionRows,
  lockSuggestion,
  oldestOpen,
  openCount,
  projectTechnologies,
  openOfSources,
  readPollState,
  resolve,
  restorePolled,
  setPayload,
  skillNamesOf,
  statusesOfKeys,
  supersede,
  type SuggestionRow,
  writeProfileSnapshot,
} from '../repositories/suggestion.repository.js';
import {
  currentOf,
  fromGithubProfile,
  fromGithubSocialAccounts,
  fromLinkedinClaims,
  patchOf,
  SOCIAL_FIELDS,
  type ProfileField,
  type ProfileNow,
  quarterOf,
} from './profile-rules.js';
import {
  isOffered,
  isUpdateStale,
  newRepoRows,
  PROJECT_FIELDS,
  updateRows,
  type WantedProjectRow,
} from './project-rules.js';
import {
  ProjectSuggestionsService,
  type UpstreamByProject,
} from './project-suggestions.service.js';
import { type EvidenceItem, skillKey, skillsToOffer } from './skill-rules.js';

const CURSOR_SCOPE = 'sug';
const DAY_MS = 86_400_000;
const REPO_PAGE = 100;

interface Row {
  kind: SuggestionKind;
  source: 'github' | 'linkedin';
  dedupeKey: string;
  payload: Record<string, unknown>;
  targetId?: string | null;
}

/** The newest page of the student's repositories as read just now, and whether it was all of them. */
interface Listed {
  page: GithubRepo[];
  complete: boolean;
  githubUserId: number;
}

/** GitHub's social accounts, read per refresh; `undefined`: GitHub was not asked. */
type SocialAccounts = GithubSocialAccount[] | undefined;

/** What GitHub showed of the university (emails, organisations); `undefined`: not asked or not configured. */
type EducationRead = EducationEvidence | undefined;

/** The newest repositories' evidence is read per refresh; `undefined`: GitHub was not asked. */
type RepoEvidence = EvidenceItem[] | undefined;

/** One evidence item per project; a project imported from a repository is that repository's item. */
const projectEvidence = (
  rows: { projectId: string; githubRepoId: number | null; name: string }[],
): EvidenceItem[] => {
  const byProject = new Map<string, EvidenceItem & { names: string[] }>();
  for (const r of rows) {
    const item = byProject.get(r.projectId) ?? {
      id: r.githubRepoId === null ? `project:${r.projectId}` : `repo:${r.githubRepoId}`,
      from: 'project' as const,
      names: [],
    };
    item.names.push(r.name);
    byProject.set(r.projectId, item);
  }
  return [...byProject.values()];
};

const isSocialKind = (kind: string): boolean =>
  Object.values(SOCIAL_FIELDS).some((f) => `profile.${f}` === kind);

const skillOf = (p: Record<string, unknown>): string | null =>
  typeof p.skill === 'string' ? p.skill : null;

const evidenceOf = (p: Record<string, unknown>): SuggestionView['evidence'] => {
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return { total: n(p.evidence), repositories: n(p.repositories), projects: n(p.projects) };
};

const payloadOf = (row: SuggestionRow): Record<string, unknown> => row.payload ?? {};

const profileNow = (u: UserRow): ProfileNow => ({
  name: u.name,
  headline: u.headline,
  bio: u.bio,
  location: u.location,
  avatarUrl: u.avatarUrl,
  github: u.github,
  website: u.website,
  linkedin: u.linkedin,
  twitter: u.twitter,
});

/**
 * Suggestions (docs/modules/m7/plan.md §6): what GitHub and the sign-in claims say the
 * profile could hold, kept as rows the student accepts or dismisses. A refresh
 * computes them; nothing is written to the profile except by an accept, which
 * changes the field and the suggestion in one transaction.
 */
@Injectable()
export class SuggestionsService {
  constructor(
    private readonly dbs: DbService,
    private readonly connection: GithubConnectionService,
    private readonly profiles: ProfileService,
    private readonly skills: SkillsService,
    private readonly changes: ProjectSuggestionsService,
    private readonly entries: EducationSuggestionsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** `GET /v1/me/suggestions`. */
  async list(user: UserRow, query: SuggestionQuery): Promise<SuggestionPage> {
    const limit = query.limit ?? this.cfg.SUGGESTIONS_PAGE_SIZE;
    if (limit > this.cfg.SUGGESTIONS_PAGE_MAX) {
      throw new ValidationError([
        { path: 'limit', message: `must be at most ${this.cfg.SUGGESTIONS_PAGE_MAX}` },
      ]);
    }
    let after: { t: number; id: string } | undefined;
    if (query.cursor !== undefined) {
      after = decodeTimeCursor(query.cursor, CURSOR_SCOPE);
      if (after === undefined) {
        throw new ValidationError([{ path: 'cursor', message: 'is not a cursor this API issued' }]);
      }
    }
    const rows = await listSuggestionRows(this.dbs.db, user.id, {
      status: query.status,
      ...(after === undefined ? {} : { after }),
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => this.view(r, user)),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeTimeCursor({ t: last.createdAt.getTime(), id: last.id }, CURSOR_SCOPE)
          : null,
      openCount: await openCount(this.dbs.db, user.id),
    };
  }

  /**
   * `POST /v1/me/suggestions/refresh`: read GitHub's public profile (at most
   * once per SUGGESTIONS_MIN_INTERVAL_S, conditionally by ETag) and recompute
   * what is suggested from it and from the sign-in claims. GitHub is asked
   * outside any transaction; what the rules decide is decided afterwards, under
   * the user lock, from the rows as they are then.
   */
  async refresh(user: UserRow, identity: AccessTokenIdentity): Promise<RefreshResponse> {
    const floor = this.cfg.SUGGESTIONS_MIN_INTERVAL_S;
    const state = await readPollState(this.dbs.db, user.id);
    let github: RefreshResponse['github'] = 'not_connected';
    let fresh: { profile: GithubProfile; etag: string | null } | undefined;
    let repoEvidence: RepoEvidence;
    let social: SocialAccounts;
    let education: EducationRead;
    let listed: Listed | undefined;
    let upstream: UpstreamByProject | undefined;

    if (state?.status === 'connected') {
      if (!(await claimRefresh(this.dbs.db, user.id, floor))) {
        github = 'throttled';
      } else {
        try {
          const { gh, token, githubUserId } = await this.connection.requireConnected(
            user,
            identity,
          );
          const usable = state.etag !== null && state.snapshot !== null;
          let read;
          try {
            read = await gh.github.getProfile(token, usable ? state.etag : null);
            try {
              const repos = await this.readRepoEvidence(gh.github, token, githubUserId);
              repoEvidence = repos.evidence;
              listed = { ...repos, githubUserId: Number(githubUserId) };
              upstream = await this.changes.readUpstream(gh.github, token, user.id, repos.page);
              social = (await gh.github.listSocialAccounts(token)).accounts;
              education = await this.entries.read(gh.github, token);
            } catch (err) {
              // The profile was read a moment ago: a token refused now was revoked in
              // between (a disconnect). Sync decides from the connection row; the
              // repositories are simply not known this time.
              if (!(err instanceof GithubNotLinkedError)) throw err;
              gh.tokens.forget(user.auth0Id);
            }
          } catch (err) {
            if (err instanceof GithubNotLinkedError) gh.tokens.forget(user.auth0Id);
            throw err;
          }
          if (read.notModified) {
            github = 'unchanged';
          } else {
            github = 'refreshed';
            fresh = { profile: read.profile, etag: read.etag };
          }
        } catch (err) {
          // The student is not made to wait for a read that did not happen.
          await restorePolled(this.dbs.db, user.id, state.polledAt);
          throw err;
        }
      }
    }

    const outcome = await this.sync(user, identity, {
      readGithub: github === 'refreshed' || github === 'unchanged',
      startedGeneration: state?.generation ?? null,
      previousPolledAt: state?.polledAt ?? null,
      fresh,
      repoEvidence,
      social,
      education,
      listed,
      upstream,
    });
    if (outcome.githubDropped === 'gone') github = 'not_connected';
    // Connected again, as another connection: nothing of this read was applied; try again.
    if (outcome.githubDropped === 'replaced') github = 'discarded';
    const polled = (await readPollState(this.dbs.db, user.id))?.polledAt ?? null;
    return {
      github,
      nextAllowedAt:
        github !== 'not_connected' && polled !== null
          ? new Date(polled.getTime() + floor * 1000).toISOString()
          : null,
      created: outcome.created,
      openCount: await openCount(this.dbs.db, user.id),
    };
  }

  /**
   * The student's own public repositories (not forks) as evidence for skills:
   * one page of the newest 100, each with its primary language and topics, and
   * for the SUGGESTIONS_LANGUAGE_REPOS newest also GitHub's list of languages.
   * At most 2 + that many calls (the profile read is the first). The page itself
   * is returned too, for the repository-change suggestions.
   */
  private async readRepoEvidence(
    github: GithubClient,
    token: GithubAccessToken,
    githubUserId: string,
  ): Promise<{ evidence: EvidenceItem[]; page: GithubRepo[]; complete: boolean }> {
    const page = await github.listRepos(token, { page: 1, perPage: REPO_PAGE });
    const own = page.items.filter((r) => !r.fork && r.ownerId === Number(githubUserId));
    const items: EvidenceItem[] = [];
    for (const [i, repo] of own.entries()) {
      const languages =
        i < this.cfg.SUGGESTIONS_LANGUAGE_REPOS
          ? ((await github.listLanguages(token, repo)).languages ?? [])
          : [];
      items.push({
        id: `repo:${repo.id}`,
        from: 'repository',
        // Languages before topics: GitHub's spelling of a language ("TypeScript") wins.
        names: [...(repo.language === null ? [] : [repo.language]), ...languages, ...repo.topics],
      });
    }
    return { evidence: items, page: page.items, complete: page.nextPage === null };
  }

  /**
   * One transaction under the user lock. Everything the rules depend on is read
   * here, after the lock: the profile (a field the student filled meanwhile is
   * not "empty"), and the GitHub row (a disconnect that completed while GitHub
   * was being asked leaves nothing to write: its answer is dropped, and the
   * claim given back). The suggestions the rules want are opened unless the
   * student already answered them (the key is the memory); open ones the rules
   * no longer want are superseded; the cap supersedes the oldest.
   */
  private sync(
    user: UserRow,
    identity: AccessTokenIdentity,
    read: {
      readGithub: boolean;
      startedGeneration: number | null;
      previousPolledAt: Date | null;
      fresh: { profile: GithubProfile; etag: string | null } | undefined;
      repoEvidence: RepoEvidence;
      social: SocialAccounts;
      education: EducationRead;
      listed: Listed | undefined;
      upstream: UpstreamByProject | undefined;
    },
  ): Promise<{ created: number; githubDropped: false | 'gone' | 'replaced' }> {
    const userId = user.id;
    return inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      const row = await readPollState(trx, userId, { lock: true });
      const connected = row?.status === 'connected';
      // A GitHub answer belongs to the connection it was asked for.
      const sameConnection = !read.readGithub || row?.generation === read.startedGeneration;
      const githubOk = connected && sameConnection;
      const githubDropped =
        read.readGithub && !githubOk ? (connected ? 'replaced' : 'gone') : false;
      if (githubDropped !== false) {
        await restorePolled(trx, userId, read.previousPolledAt);
      } else if (githubOk && read.fresh !== undefined) {
        await writeProfileSnapshot(trx, userId, read.fresh.etag, read.fresh.profile);
      }

      const profile = await currentProfile(trx, userId);
      if (profile === undefined) return { created: 0, githubDropped };
      const snapshot: GithubProfile | null = !githubOk
        ? null
        : (read.fresh?.profile ?? (row?.snapshot ? { name: null, ...row.snapshot } : null));
      const lastSynced = await linkedinLastSynced(trx, userId);
      const wanted = this.wanted(profile, snapshot, identity, lastSynced);
      // Links: only from a read made just now (nothing of them is stored).
      if (githubOk && read.social !== undefined) {
        for (const w of fromGithubSocialAccounts(read.social, profile)) {
          wanted.push({
            kind: w.kind,
            source: w.source,
            dedupeKey: w.dedupeKey,
            payload: { field: w.field, value: w.value, mode: w.mode },
          });
        }
      }
      // Education and organisations (plan §6.6f): only from a read made just now.
      const entryPlan = await this.entries.plan(trx, userId, read.education, githubOk);
      for (const w of entryPlan.rows) {
        wanted.push({ kind: w.kind, source: 'github', dedupeKey: w.dedupeKey, payload: w.payload });
      }
      // Skills: the repositories only when GitHub was asked just now; the projects always.
      const have = await skillNamesOf(trx, userId);
      const projectItems = projectEvidence(await projectTechnologies(trx, userId));
      const offered = skillsToOffer(
        [...(githubOk ? (read.repoEvidence ?? []) : []), ...projectItems],
        have,
      );
      for (const w of offered) {
        wanted.push({
          kind: 'skill.add',
          source: 'github',
          dedupeKey: w.dedupeKey,
          payload: {
            skill: w.name,
            evidence: w.evidence,
            repositories: w.repositories,
            projects: w.projects,
          },
        });
      }

      // Repository changes (plan §6.6e): decided from the projects as they are under
      // their locks, whatever was read before them.
      const open = await openOfSources(trx, userId, ['github', 'linkedin']);
      const openNew = open.filter((r) => r.kind === 'project.new');
      const openUpdates = open.filter((r) => r.kind === 'project.update');
      // A dropped connection (a disconnect, or another one, while GitHub was asked) has
      // no answer to use.
      const listed = githubOk ? read.listed : undefined;
      const upstream = githubOk ? read.upstream : undefined;
      const states = await lockProjectStates(trx, userId, [
        ...(upstream?.keys() ?? []),
        ...openUpdates.flatMap((r) => (r.targetId === null ? [] : [r.targetId])),
      ]);
      const repoIdOf = (r: SuggestionRow) => payloadOf(r).repoId;
      const importedNow = await importedProjectIds(trx, userId, [
        ...(listed?.page.map((r) => r.id) ?? []),
        ...openNew.flatMap((r) => {
          const id = repoIdOf(r);
          return typeof id === 'number' ? [id] : [];
        }),
      ]);
      const projectRows: WantedProjectRow[] = [];
      if (listed !== undefined) {
        projectRows.push(
          ...newRepoRows(
            listed.page,
            listed.githubUserId,
            new Set(importedNow.keys()),
            this.cfg.SUGGESTIONS_NEW_REPOS,
          ),
        );
      }
      if (upstream !== undefined) {
        projectRows.push(...updateRows(states, upstream));
      }
      for (const w of projectRows) {
        wanted.push({
          kind: w.kind,
          source: 'github',
          dedupeKey: w.dedupeKey,
          payload: w.payload,
          targetId: w.targetId,
        });
      }

      const known = await statusesOfKeys(
        trx,
        userId,
        wanted.map((w) => w.dedupeKey),
      );
      let created = 0;
      const announced: { id: string; kind: SuggestionKind }[] = [];
      for (const w of wanted) {
        if (known.has(w.dedupeKey)) continue;
        const id = await insertOpen(trx, userId, w);
        created++;
        if (w.kind === 'project.new' || w.kind === 'project.update') {
          announced.push({ id, kind: w.kind });
        }
      }

      const wantedKeys = new Set(wanted.map((w) => w.dedupeKey));
      // Connected but not read just now (inside the floor), an open skill is kept unless
      // the profile has it now: what the repositories show is only known after a read.
      const haveKeys = new Set(have.map(skillKey));
      // Not connected: there are no repositories, which is known.
      const repositoriesKnown = !githubOk || read.repoEvidence !== undefined;
      // The same for a social link: kept unless its field was filled meanwhile.
      const socialKnown = !githubOk || read.social !== undefined;
      const socialFieldFilled = (r: SuggestionRow) => {
        const field = payloadOf(r).field;
        return (
          typeof field !== 'string' ||
          !Object.values(SOCIAL_FIELDS).includes(field as never) ||
          currentOf(profile, field as ProfileField) !== null
        );
      };
      const listedById = new Map(listed?.page.map((r) => [r.id, r]));
      // A new repository stays offered until it is imported or is no longer the student's
      // own work; one that fell out of the newest few is not withdrawn for that.
      const newGone = (r: SuggestionRow) => {
        const repoId = repoIdOf(r);
        if (typeof repoId !== 'number' || !githubOk || importedNow.has(repoId)) return true;
        if (listed === undefined) return false;
        const repo = listedById.get(repoId);
        return repo === undefined ? listed.complete : !isOffered(repo, listed.githubUserId);
      };
      // An update stays offered until it cannot be applied, or GitHub was read just now
      // and no longer differs from what the project holds.
      const updateGone = (r: SuggestionRow) => {
        if (!githubOk) return true;
        const projectId = r.targetId;
        if (isUpdateStale(payloadOf(r), projectId === null ? undefined : states.get(projectId))) {
          return true;
        }
        const field = PROJECT_FIELDS.find((f) => f === payloadOf(r).field);
        const seen = projectId === null ? undefined : upstream?.get(projectId)?.values;
        return field !== undefined && seen?.[field] !== undefined;
      };
      const gone = (r: SuggestionRow) =>
        !wantedKeys.has(r.dedupeKey) &&
        (r.kind === 'skill.add'
          ? repositoriesKnown || haveKeys.has(skillKey(skillOf(payloadOf(r)) ?? ''))
          : isSocialKind(r.kind)
            ? socialKnown || socialFieldFilled(r)
            : isEntryKind(r.kind)
              ? entryPlan.gone(r)
              : r.kind === 'project.new'
                ? newGone(r)
                : r.kind === 'project.update'
                  ? updateGone(r)
                  : true);
      await supersede(
        trx,
        userId,
        open.filter(gone).map((r) => r.id),
      );

      const total = await openCount(trx, userId);
      const capped = new Set<string>();
      if (total > this.cfg.SUGGESTIONS_MAX_OPEN) {
        const extra = await oldestOpen(trx, userId, total - this.cfg.SUGGESTIONS_MAX_OPEN);
        await supersede(
          trx,
          userId,
          extra.map((r) => r.id),
        );
        for (const r of extra) capped.add(r.id);
      }
      // One notification for the batch, in this transaction: it commits with the
      // suggestions it announces, so each is announced once. Stars, forks and the
      // other kinds are not announced here.
      const open2 = announced.filter((a) => !capped.has(a.id));
      if (open2.length > 0) {
        await insertSuggestionsNotification(trx, userId, {
          count: open2.length,
          kinds: [...new Set(open2.map((a) => a.kind))].sort(),
        });
      }
      return { created, githubDropped };
    });
  }

  /** What the rules want of this profile, GitHub's public profile and the sign-in claims. */
  private wanted(
    profile: ProfileNow,
    snapshot: GithubProfile | null,
    identity: AccessTokenIdentity,
    lastSynced: Date | null,
  ): Row[] {
    const wanted: Row[] = [
      ...(snapshot === null ? [] : fromGithubProfile(snapshot, profile)),
      ...fromLinkedinClaims(identity, profile),
    ].map((w) => ({
      kind: w.kind,
      source: w.source,
      dedupeKey: w.dedupeKey,
      payload: { field: w.field, value: w.value, mode: w.mode },
    }));
    const linkedinLinked =
      identity.sub.startsWith('linkedin|') || identity.identities.includes('linkedin');
    const nowMs = Date.now();
    if (
      linkedinLinked &&
      (lastSynced === null ||
        nowMs - lastSynced.getTime() > this.cfg.LINKEDIN_REIMPORT_DAYS * DAY_MS)
    ) {
      wanted.push({
        kind: 'linkedin.reimport',
        source: 'linkedin',
        dedupeKey: `linkedin:reimport:${quarterOf(new Date(nowMs))}`,
        payload: { lastSyncedAt: lastSynced?.toISOString() ?? null },
      });
    }
    return wanted;
  }

  /** `POST /v1/me/suggestions/{id}/accept`. */
  async accept(
    user: UserRow,
    identity: AccessTokenIdentity,
    id: string,
    overrides?: AcceptOverrides,
  ): Promise<ResolveResponse> {
    const memo: AvatarMemo = {};
    type Outcome =
      | {
          kind: 'done';
          applied: ResolveResponse['applied'];
          released: string[];
          projectId?: string | null;
        }
      | { kind: 'invalid' }
      | { kind: 'limit' }
      | { kind: 'stale'; what: 'skill' | 'link' | 'project' | 'entry' }
      /** A `project.new`: imported after this transaction, with no lock held. */
      | { kind: 'import'; row: SuggestionRow };
    let outcome: Outcome = await inTransaction(this.dbs.db, async (trx): Promise<Outcome> => {
      await lockUser(trx, user.id);
      const row = await lockSuggestion(trx, user.id, id);
      if (row === undefined) throw new NotFoundError('suggestion');
      if (row.status === 'accepted') {
        return {
          kind: 'done',
          applied: this.applied(row),
          released: [],
          projectId: this.changes.projectIdOf(row),
        };
      }
      if (row.status !== 'open') {
        throw new ConflictError('SUGGESTION_RESOLVED', 'this suggestion is no longer open');
      }
      if (!isEntryKind(row.kind) && Object.values(overrides ?? {}).some((v) => v !== undefined)) {
        throw new ValidationError([
          { path: 'overrides', message: 'only education.add and experience.add take overrides' },
        ]);
      }
      if (isEntryKind(row.kind)) {
        const done = await this.entries.applyIn(trx, user.id, row, overrides);
        if (done.kind === 'stale') {
          await supersede(trx, user.id, [id]);
          return { kind: 'stale', what: 'entry' };
        }
        await resolve(trx, user.id, id, 'accepted');
        return { kind: 'done', applied: done.applied, released: [] };
      }
      if (row.kind === 'linkedin.reimport') {
        await resolve(trx, user.id, id, 'accepted');
        return { kind: 'done', applied: null, released: [] };
      }
      if (row.kind === 'project.new') return { kind: 'import', row };
      if (row.kind === 'project.update') {
        const done = await this.changes.applyUpdateIn(trx, user, row);
        return done.kind === 'done'
          ? { kind: 'done', applied: done.applied, released: [], projectId: done.projectId }
          : done.kind === 'stale'
            ? { kind: 'stale', what: 'project' }
            : { kind: done.kind };
      }
      if (row.kind === 'skill.add') {
        const skill = skillOf(payloadOf(row)) ?? '';
        const before = await skillNamesOf(trx, user.id);
        const after = await this.skills.addIn(trx, user.id, skill);
        if (after.length === before.length) {
          // Already on the profile (the registry matches case and accents like the list does).
          await supersede(trx, user.id, [id]);
          return { kind: 'stale', what: 'skill' };
        }
        await resolve(trx, user.id, id, 'accepted');
        // The spelling written, which the registry may have fixed differently.
        const had = new Set(before.map(skillKey));
        const written = after.find((n) => !had.has(skillKey(n))) ?? skill;
        // A retry reports this spelling, not the one first suggested.
        await setPayload(trx, user.id, id, { ...payloadOf(row), skill: written });
        return { kind: 'done', applied: { field: 'skills', value: written }, released: [] };
      }
      const stored = payloadOf(row);
      const field = stored.field as ProfileField;
      const value = stored.value;
      if (isSocialKind(row.kind)) {
        // Fill only: a link the student typed since the offer is never replaced.
        const now = await currentProfile(trx, user.id);
        if (now === undefined || currentOf(now, field) !== null) {
          await supersede(trx, user.id, [id]);
          return { kind: 'stale', what: 'link' };
        }
      }
      const patch = updateProfileSchema.safeParse(
        typeof value === 'string' ? patchOf(field, value) : {},
      );
      if (!patch.success) {
        // The write's rules refuse it now (a limit was tightened): it is moot.
        await supersede(trx, user.id, [id]);
        return { kind: 'invalid' };
      }
      const released = await this.profiles.applyHeaderIn(trx, user.id, patch.data, memo);
      await resolve(trx, user.id, id, 'accepted');
      return { kind: 'done', applied: { field, value: value as string }, released };
    });
    if (outcome.kind === 'import') {
      const imported = await this.changes.acceptNew(user, identity, outcome.row);
      outcome =
        imported.kind === 'done'
          ? { kind: 'done', applied: imported.applied, released: [], projectId: imported.projectId }
          : imported.kind === 'stale'
            ? { kind: 'stale', what: 'project' }
            : { kind: imported.kind };
    }
    if (outcome.kind === 'invalid') {
      throw new ConflictError('SUGGESTION_INVALID', 'this value can no longer be written');
    }
    if (outcome.kind === 'limit') {
      throw new ConflictError('LIMIT_REACHED', 'the maximum number of projects is reached');
    }
    if (outcome.kind === 'stale') {
      throw new ConflictError(
        'SUGGESTION_STALE',
        outcome.what === 'skill'
          ? 'this skill is already on the profile'
          : outcome.what === 'link'
            ? 'this link is already set on the profile'
            : outcome.what === 'entry'
              ? 'the profile already has this entry, or it is no longer offered'
              : 'the project or the repository changed since this was suggested',
      );
    }
    // Only a `done` outcome is left; `import` was turned into one of the others above.
    if (outcome.kind !== 'done') throw new Error('accept ended without an answer');
    await this.profiles.releaseFiles(outcome.released);
    return {
      id,
      status: 'accepted',
      applied: outcome.applied,
      projectId: outcome.projectId ?? null,
    };
  }

  /** `POST /v1/me/suggestions/{id}/dismiss`: remembered by its key until the value changes. */
  async dismiss(user: UserRow, id: string): Promise<ResolveResponse> {
    await inTransaction(this.dbs.db, async (trx) => {
      const row = await lockSuggestion(trx, user.id, id);
      if (row === undefined) throw new NotFoundError('suggestion');
      if (row.status === 'dismissed') return;
      if (row.status !== 'open') {
        throw new ConflictError('SUGGESTION_RESOLVED', 'this suggestion is no longer open');
      }
      await resolve(trx, user.id, id, 'dismissed');
    });
    return { id, status: 'dismissed', applied: null, projectId: null };
  }

  private applied(row: SuggestionRow): ResolveResponse['applied'] {
    if (row.kind === 'project.new' || row.kind === 'project.update') {
      return this.changes.appliedOf(row);
    }
    if (row.kind === 'skill.add') {
      const skill = payloadOf(row).skill;
      return typeof skill === 'string' ? { field: 'skills', value: skill } : null;
    }
    const { field, value } = payloadOf(row) as { field?: unknown; value?: unknown };
    return typeof field === 'string' && typeof value === 'string' ? { field, value } : null;
  }

  private view(row: SuggestionRow, user: UserRow): SuggestionView {
    const p = payloadOf(row) as { field?: string; value?: string; mode?: 'fill' | 'replace' };
    const isProfile = row.kind.startsWith('profile.');
    const isSkill = row.kind === 'skill.add';
    const isUpdate = row.kind === 'project.update';
    const isNew = row.kind === 'project.new';
    const isEntry = isEntryKind(row.kind);
    const stored = payloadOf(row);
    const text = (v: unknown) => (typeof v === 'string' ? v : null);
    const repoId = stored.repoId;
    return {
      id: row.id,
      kind: row.kind as SuggestionKind,
      source: row.source,
      status: row.status,
      field: isProfile || isUpdate || isEntry ? (p.field ?? null) : null,
      current:
        isProfile && row.status === 'open' && p.field !== undefined
          ? currentOf(profileNow(user), p.field as ProfileField)
          : null,
      proposed: isProfile || isUpdate || isEntry ? (p.value ?? null) : null,
      mode: isProfile ? (p.mode ?? null) : null,
      skill: isSkill ? skillOf(payloadOf(row)) : null,
      evidence: isSkill ? evidenceOf(payloadOf(row)) : null,
      repository:
        (isNew || isUpdate) && typeof repoId === 'number'
          ? { id: repoId, fullName: text(stored.fullName) ?? '' }
          : null,
      project: isUpdate
        ? { id: row.targetId, title: text(stored.title) ?? '' }
        : isNew
          ? { id: text(stored.projectId), title: text(stored.name) ?? '' }
          : null,
      lastSyncedAt:
        row.kind === 'linkedin.reimport'
          ? ((payloadOf(row) as { lastSyncedAt?: string | null }).lastSyncedAt ?? null)
          : null,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
    };
  }
}
