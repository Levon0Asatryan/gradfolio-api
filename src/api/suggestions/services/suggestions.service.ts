import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { lockUser } from '../../../core/db/user-lock.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { GithubNotLinkedError } from '../../../core/github/errors.js';
import type { GithubProfile } from '../../../core/github/github-client.js';
import { decodeTimeCursor, encodeTimeCursor } from '../../common/utils/time-cursor.js';
import { updateProfileSchema } from '../../profiles/dto/profile.dto.js';
import { ProfileService, type AvatarMemo } from '../../profiles/services/profile.service.js';
import { GithubConnectionService } from '../../integrations/services/github-connection.service.js';
import type { UserRow } from '../../users/repositories/user.repository.js';
import type {
  RefreshResponse,
  ResolveResponse,
  SuggestionKind,
  SuggestionPage,
  SuggestionQuery,
  SuggestionView,
} from '../dto/suggestion.dto.js';
import {
  claimRefresh,
  currentProfile,
  insertOpen,
  linkedinLastSynced,
  listSuggestionRows,
  lockSuggestion,
  oldestOpen,
  openCount,
  openOfSources,
  readPollState,
  resolve,
  restorePolled,
  statusesOfKeys,
  supersede,
  type SuggestionRow,
  writeProfileSnapshot,
} from '../repositories/suggestion.repository.js';
import {
  currentOf,
  fromGithubProfile,
  fromLinkedinClaims,
  patchOf,
  type ProfileField,
  type ProfileNow,
  quarterOf,
} from './profile-rules.js';

const CURSOR_SCOPE = 'sug';
const DAY_MS = 86_400_000;

interface Row {
  kind: SuggestionKind;
  source: 'github' | 'linkedin';
  dedupeKey: string;
  payload: Record<string, unknown>;
}

const payloadOf = (row: SuggestionRow): Record<string, unknown> => row.payload ?? {};

const profileNow = (u: UserRow): ProfileNow => ({
  name: u.name,
  headline: u.headline,
  bio: u.bio,
  location: u.location,
  avatarUrl: u.avatarUrl,
  github: u.github,
  website: u.website,
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

    if (state?.status === 'connected') {
      if (!(await claimRefresh(this.dbs.db, user.id, floor))) {
        github = 'throttled';
      } else {
        try {
          const { gh, token } = await this.connection.requireConnected(user, identity);
          const usable = state.etag !== null && state.snapshot !== null;
          let read;
          try {
            read = await gh.github.getProfile(token, usable ? state.etag : null);
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

      const known = await statusesOfKeys(
        trx,
        userId,
        wanted.map((w) => w.dedupeKey),
      );
      let created = 0;
      for (const w of wanted) {
        if (known.has(w.dedupeKey)) continue;
        await insertOpen(trx, userId, w);
        created++;
      }

      const wantedKeys = new Set(wanted.map((w) => w.dedupeKey));
      const open = await openOfSources(trx, userId, ['github', 'linkedin']);
      await supersede(
        trx,
        userId,
        open.filter((r) => !wantedKeys.has(r.dedupeKey)).map((r) => r.id),
      );

      const total = await openCount(trx, userId);
      if (total > this.cfg.SUGGESTIONS_MAX_OPEN) {
        const extra = await oldestOpen(trx, userId, total - this.cfg.SUGGESTIONS_MAX_OPEN);
        await supersede(
          trx,
          userId,
          extra.map((r) => r.id),
        );
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
  async accept(user: UserRow, id: string): Promise<ResolveResponse> {
    const memo: AvatarMemo = {};
    type Outcome =
      | { kind: 'done'; applied: ResolveResponse['applied']; released: string[] }
      | { kind: 'invalid' };
    const outcome = await inTransaction(this.dbs.db, async (trx): Promise<Outcome> => {
      await lockUser(trx, user.id);
      const row = await lockSuggestion(trx, user.id, id);
      if (row === undefined) throw new NotFoundError('suggestion');
      if (row.status === 'accepted') {
        return { kind: 'done', applied: this.applied(row), released: [] };
      }
      if (row.status !== 'open') {
        throw new ConflictError('SUGGESTION_RESOLVED', 'this suggestion is no longer open');
      }
      if (row.kind === 'linkedin.reimport') {
        await resolve(trx, user.id, id, 'accepted');
        return { kind: 'done', applied: null, released: [] };
      }
      const stored = payloadOf(row);
      const field = stored.field as ProfileField;
      const value = stored.value;
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
    if (outcome.kind === 'invalid') {
      throw new ConflictError('SUGGESTION_INVALID', 'this value can no longer be written');
    }
    await this.profiles.releaseFiles(outcome.released);
    return { id, status: 'accepted', applied: outcome.applied };
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
    return { id, status: 'dismissed', applied: null };
  }

  private applied(row: SuggestionRow): ResolveResponse['applied'] {
    const { field, value } = payloadOf(row) as { field?: unknown; value?: unknown };
    return typeof field === 'string' && typeof value === 'string' ? { field, value } : null;
  }

  private view(row: SuggestionRow, user: UserRow): SuggestionView {
    const p = payloadOf(row) as { field?: string; value?: string; mode?: 'fill' | 'replace' };
    const isProfile = row.kind.startsWith('profile.');
    return {
      id: row.id,
      kind: row.kind as SuggestionKind,
      source: row.source,
      status: row.status,
      field: isProfile ? (p.field ?? null) : null,
      current:
        isProfile && row.status === 'open' && p.field !== undefined
          ? currentOf(profileNow(user), p.field as ProfileField)
          : null,
      proposed: isProfile ? (p.value ?? null) : null,
      mode: isProfile ? (p.mode ?? null) : null,
      lastSyncedAt:
        row.kind === 'linkedin.reimport'
          ? ((payloadOf(row) as { lastSyncedAt?: string | null }).lastSyncedAt ?? null)
          : null,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
    };
  }
}
