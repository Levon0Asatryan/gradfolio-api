import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { IntegrationUnavailableError } from '../../../core/auth0/errors.js';
import type { LinkResult } from '../../../core/auth0/management-client.js';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import type { DB } from '../../../core/db/types.generated.js';
import { isMysqlError, MysqlErrno } from '../../../core/db/mysql-errors.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { lockUser } from '../../../core/db/user-lock.js';
import { AppError, ConflictError } from '../../../core/errors/app-error.js';
import { GithubNotLinkedError, GithubRevokeFailedError } from '../../../core/github/errors.js';
import type { GithubUser } from '../../../core/github/github-client.js';
import type { GithubAccessToken } from '../../../core/github/github-access-token.js';
import type { GithubIdentity } from '../../../core/github/token-source.js';
import type { UserRow } from '../../users/repositories/user.repository.js';
import type {
  ConnectResponse,
  DisconnectResponse,
  IntegrationsResponse,
  LinkResponse,
} from '../dto/integration.dto.js';
import { GITHUB_CONNECT, type GithubConnect } from '../integrations.constants.js';
import {
  accountExists,
  integrationsOf,
  type IntegrationRow,
  isRevocationMarker,
  lockGithubRow,
  setUserVerified,
  staleReservation,
  versionOf,
  writeGithubRow,
} from '../repositories/integration.repository.js';
import { consumeNonce, insertNonce } from '../repositories/nonce.repository.js';

/**
 * Seconds past a link's deadline before its reservation counts as stale:
 * `updated_at` has whole seconds (MySQL rounds a fraction), and the deadline
 * starts a moment after the reservation commits.
 */
const RECONCILE_MARGIN_S = 2;

const accountInUse = () =>
  new ConflictError(
    'GITHUB_ACCOUNT_IN_USE',
    'this GitHub account already belongs to another Gradfolio account',
  );
const linkInProgress = () =>
  new ConflictError('GITHUB_LINK_IN_PROGRESS', 'a GitHub link is still in progress; try again');
export const stateChanged = () =>
  new ConflictError(
    'GITHUB_STATE_CHANGED',
    'GitHub was connected or disconnected at the same moment; reload and try again',
  );

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * GitHub connect, link and disconnect (docs/m7-plan.md §2.3), and the
 * integrations card (§4.4).
 *
 * "Connected" is our consent flag (`integrations.status`), distinct from an
 * identity existing at Auth0. A `'linking'` row is a reservation: it holds the
 * GitHub id's unique key while Auth0 is asked to link, and never counts as
 * connected. The two systems share no transaction, so a half-done link is
 * settled from Auth0's own record by `reconcile`, which every GitHub route
 * runs first.
 */
@Injectable()
export class GithubConnectionService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(GITHUB_CONNECT) private readonly gh: GithubConnect | null,
    @InjectPinoLogger(GithubConnectionService.name) private readonly logger: PinoLogger,
  ) {}

  /** `GET /v1/me/integrations`: the caller's own rows only; never a token or the GitHub id. */
  async status(user: UserRow, identity: AccessTokenIdentity): Promise<IntegrationsResponse> {
    if (this.gh) await this.reconcile(this.gh, user);
    const rows = await integrationsOf(this.dbs.db, user.id);
    const github = rows.find((r) => r.integrationType === 'github');
    const linkedin = rows.find((r) => r.integrationType === 'linkedin');
    const connected = github?.status === 'connected';
    return {
      github: {
        available: this.gh !== null,
        status: connected ? 'connected' : 'not_connected',
        login: connected ? (github.externalLogin ?? null) : null,
        lastSyncedAt: github?.lastSyncedAt?.toISOString() ?? null,
      },
      linkedin: {
        // Derived from the token at read time (plan §4.4): the API stores no identities.
        status:
          identity.sub.startsWith('linkedin|') || identity.identities.includes('linkedin')
            ? 'connected'
            : 'not_connected',
        lastSyncedAt: linkedin?.lastSyncedAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * What a GitHub read or import needs: the connected flag is on, and Auth0
   * still holds the identity (and a token) of the GitHub account that was
   * connected. A flag whose identity is gone is cleared (plan §2.3) and answers
   * 409 GITHUB_NOT_LINKED; a different GitHub account at Auth0 than the one
   * connected is the same answer, without clearing (the student reconnects).
   */
  async requireConnected(
    user: UserRow,
    identity: AccessTokenIdentity,
  ): Promise<{ gh: GithubConnect; token: GithubAccessToken; githubUserId: string }> {
    const gh = this.required();
    await this.reconcile(gh, user);
    const row = await this.githubRow(user.id);
    if (row?.status !== 'connected') {
      throw new ConflictError('GITHUB_NOT_CONNECTED', 'connect GitHub first');
    }
    const found = await gh.tokens.tokenFor(user.auth0Id);
    if (found === null) {
      await this.markDisconnected(user.id, identity, versionOf(row));
      throw new GithubNotLinkedError('no github identity at auth0');
    }
    if (found.githubUserId !== row.externalUserId) {
      gh.tokens.forget(user.auth0Id);
      throw new GithubNotLinkedError('a different github account is linked');
    }
    return { gh, token: found.token, githubUserId: found.githubUserId };
  }

  /**
   * `POST /v1/me/integrations/github/connect`. Auth0 is asked whether a GitHub
   * identity is linked (the token's `identities` claim can be an hour stale);
   * if so, GitHub confirms the token and the flag is set. Otherwise a link
   * nonce is issued, and a flag left from an identity that is gone at Auth0 is
   * cleared (plan §2.3: a token fetch that finds no identity clears it).
   */
  async connect(user: UserRow, identity: AccessTokenIdentity): Promise<ConnectResponse> {
    const gh = this.required();
    await this.reconcile(gh, user);
    const row = await this.githubRow(user.id);
    if (row?.status === 'linking') throw linkInProgress();

    const found = await gh.tokens.tokenFor(user.auth0Id);
    if (found === null) {
      if (row?.status === 'connected') {
        await this.markDisconnected(user.id, identity, versionOf(row));
      }
      return this.issueNonce(user.id);
    }
    const ghUser = await this.githubUser(gh, user.auth0Id, found);
    // Only onto the row as it was read: a disconnect that revoked this token
    // meanwhile must not be undone with it.
    await this.markConnected(user.id, ghUser, versionOf(row));
    this.logger.info({ userId: user.id }, 'github connected');
    return { state: 'connected', login: ghUser.login };
  }

  /**
   * `POST /v1/me/integrations/github/link` (plan §2.3): verify the id token,
   * consume the nonce, reserve the GitHub id, ask Auth0 to link, then confirm.
   * The id token is never logged and never stored.
   */
  async link(user: UserRow, idToken: string): Promise<LinkResponse> {
    const gh = this.required();
    const claims = await gh.idTokens.verify(idToken);
    await this.reconcile(gh, user);
    if (!(await consumeNonce(this.dbs.db, sha256(claims.nonce), user.id))) {
      throw new AppError(
        'INVALID_NONCE',
        'the link request expired or was already used; start again',
        400,
      );
    }

    // Step 3: reserve, before Auth0 is touched. Another Gradfolio user holding
    // this GitHub id loses here, on the unique key.
    const reserved = await inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, user.id);
      const row = await lockGithubRow(trx, user.id);
      if (row?.status === 'connected') {
        throw new ConflictError(
          'GITHUB_ALREADY_CONNECTED',
          'a GitHub account is already connected',
        );
      }
      if (row?.status === 'linking') throw linkInProgress();
      // That GitHub login already is a Gradfolio account: linking would orphan it.
      if (await accountExists(trx, claims.sub)) throw accountInUse();
      try {
        return await writeGithubRow(trx, user.id, row, {
          status: 'linking',
          externalUserId: claims.githubUserId,
          externalLogin: null,
        });
      } catch (err) {
        if (isMysqlError(err, MysqlErrno.DUPLICATE_KEY)) throw accountInUse();
        throw err;
      }
    });

    // Step 4: one deadline for the whole Auth0 step, so no call outlives the
    // reservation's stale age.
    const deadline = AbortSignal.timeout(gh.linkDeadlineMs);
    // Idempotent: this GitHub identity may already belong to the caller at Auth0
    // (an account deleted here leaves it linked there; a link finished but its
    // answer was lost). Auth0 refuses to link a user to what it already holds, so
    // the link is skipped and the connection finished from what Auth0 says.
    let alreadyLinked: boolean;
    try {
      const held = await gh.management.identities(user.auth0Id, deadline);
      alreadyLinked =
        held?.some(
          (i) => i.provider === 'github' && i.isSocial && i.userId === claims.githubUserId,
        ) ?? false;
    } catch (err) {
      // Nothing was linked: the reservation goes.
      await this.releaseReservation(user.id, claims.githubUserId);
      throw err;
    }
    const result: LinkResult = alreadyLinked
      ? { outcome: 'linked' }
      : await gh.management.linkIdentity(user.auth0Id, idToken, deadline);
    if (alreadyLinked) this.logger.info({ userId: user.id }, 'github identity already linked');
    switch (result.outcome) {
      case 'linked':
        break;
      case 'refused':
        await this.releaseReservation(user.id, claims.githubUserId);
        // Auth0's own words (a rule, never a credential): a refusal is a diagnosis, not a guess.
        this.logger.warn(
          {
            userId: user.id,
            status: result.status,
            auth0Error: result.detail.error,
            auth0Message: result.detail.message,
            auth0Code: result.detail.errorCode,
          },
          'github link refused by auth0',
        );
        throw new ConflictError('GITHUB_LINK_REFUSED', 'Auth0 refused to link this GitHub account');
      case 'not_attempted':
        await this.releaseReservation(user.id, claims.githubUserId);
        throw result.error;
      case 'unknown':
        // Left as a reservation: reconciliation settles it from Auth0's record.
        this.logger.warn({ userId: user.id }, 'github link outcome unknown');
        throw result.error;
    }

    // Step 5. A failure from here on also leaves the reservation for reconciliation.
    gh.tokens.forget(user.auth0Id);
    const found = await gh.tokens.tokenFor(user.auth0Id);
    if (found === null) throw new IntegrationUnavailableError('linked identity not visible yet');
    const ghUser = await this.githubUser(gh, user.auth0Id, found);
    await this.markConnected(user.id, ghUser, reserved);
    this.logger.info({ userId: user.id }, 'github linked');
    return { state: 'connected', login: ghUser.login };
  }

  /**
   * `DELETE /v1/me/integrations/github` (plan §2.3, D9): revoke at GitHub
   * first; only once GitHub confirmed (or there is nothing left to revoke) is
   * the flag cleared. A failed revocation changes nothing. Idempotent.
   */
  async disconnect(user: UserRow, identity: AccessTokenIdentity): Promise<DisconnectResponse> {
    const gh = this.required();
    await this.reconcile(gh, user);
    const row = await this.githubRow(user.id);
    if (row?.status === 'linking') throw linkInProgress();

    let expected = versionOf(row);
    if (row?.status === 'connected') {
      // The row says "in progress" for as long as GitHub may still delete the
      // grant, so a connect cannot validate the token that is about to die
      // and stamp `connected` onto a dead grant.
      expected = await this.beginRevocation(user.id, row);
      try {
        await this.revoke(gh, user.auth0Id);
      } catch (err) {
        // Back to connected only when the grant certainly stands: GitHub said
        // so, or the request never went out. After a timeout, a dropped
        // connection or a 5xx it may still be deleted, so the marker stays and
        // is settled from GitHub's word once nothing can be in flight.
        if (!(err instanceof GithubRevokeFailedError) || err.refused) {
          await this.abortRevocation(user.id, expected);
        }
        throw err;
      }
    }

    await this.markDisconnected(user.id, identity, expected);
    gh.tokens.forget(user.auth0Id);
    this.logger.info({ userId: user.id }, 'github disconnected');
    return { status: 'not_connected' };
  }

  /**
   * Before an account is deleted: a GitHub connection the student gave us is
   * revoked at GitHub first (D9), so deleting the account deletes the token, and
   * a GitHub identity linked to the login at Auth0 is unlinked (plan §2.7).
   * A failure stops the deletion; nothing is deleted. Returns the version of
   * the row it read (and revoked), for `assertRevokedForDeletion`.
   */
  async revokeBeforeAccountDeletion(user: UserRow): Promise<number | null> {
    const first = await this.githubRow(user.id);
    let version = versionOf(first);
    if (first !== undefined && first.status !== 'not_connected') {
      const gh = this.required();
      await this.reconcile(gh, user);
      const row = await this.githubRow(user.id);
      // A link or a revocation in flight can still change what the grant is:
      // revoking now, or deleting the row, would miss what it is about to make.
      if (row?.status === 'linking') throw linkInProgress();
      if (row?.status === 'connected') await this.revoke(gh, user.auth0Id);
      version = versionOf(row);
    }
    // Whatever the row says, Auth0 may still hold a GitHub identity linked to this
    // login (a disconnect keeps it): deleting the account must not leave it there.
    // Deleting the Auth0 user (opt-in) removes every identity with it: nothing to unlink.
    if (this.gh !== null && !this.cfg.AUTH0_DELETE_USERS)
      await this.unlinkGithubAtAuth0(this.gh, user);
    return version;
  }

  /**
   * Unlinks every GitHub identity that is *linked to* the caller's login (a
   * secondary one). Left linked, the next GitHub sign-in of the same person
   * resolves to this very login, and Auth0 refuses to link a user to what it
   * already holds. Auth0 re-creates each former secondary as a standalone
   * `github|<id>` user (what remains, and why it is harmless: docs/m7-plan.md
   * §2.7). An identity already gone is success; any other failure stops the
   * deletion before anything is deleted. A login that *is* the GitHub one
   * (`github|<id>`) has nothing linked to unlink.
   */
  private async unlinkGithubAtAuth0(gh: GithubConnect, user: UserRow): Promise<void> {
    const held = await gh.management.identities(user.auth0Id);
    for (const identity of held ?? []) {
      if (identity.provider !== 'github' || !identity.isSocial) continue;
      if (user.auth0Id === `github|${identity.userId}`) continue;
      const result = await gh.management.unlinkIdentity(user.auth0Id, 'github', identity.userId);
      this.logger.info({ result }, 'github identity unlinked at auth0');
    }
    gh.tokens.forget(user.auth0Id);
  }

  /**
   * Inside the deletion's transaction, under the user lock: the GitHub row is
   * still exactly the connected one the preflight revoked, or holds nothing to
   * revoke. Anything else was made after the revocation and never revoked: a
   * connection (409 GITHUB_STATE_CHANGED), a link or revocation in flight (409
   * GITHUB_LINK_IN_PROGRESS, whatever its version: a reservation whose Auth0
   * call has not returned changes no row when it completes). The student
   * retries, which settles it.
   */
  async assertRevokedForDeletion(
    trx: Transaction<DB>,
    userId: string,
    revoked: number | null,
  ): Promise<void> {
    const row = await lockGithubRow(trx, userId);
    if (row === undefined || row.status === 'not_connected') return;
    if (row.status === 'linking') throw linkInProgress();
    if (versionOf(row) !== revoked) throw stateChanged();
  }

  /**
   * After the account's data is gone (opt-in, `AUTH0_DELETE_USERS`): deletes the
   * caller's own Auth0 user, with every identity linked to it. Best effort and
   * logged: the data is already deleted, and a login that remains only comes
   * back as a blank account (Q7). Only ever the caller's verified `sub`.
   */
  async deleteAuth0UserAfterAccountDeletion(user: UserRow): Promise<void> {
    if (this.gh === null || !this.cfg.AUTH0_DELETE_USERS) return;
    try {
      const result = await this.gh.management.deleteUser(user.auth0Id);
      this.gh.tokens.forget(user.auth0Id);
      this.logger.info({ result }, 'auth0 user deleted');
    } catch (err) {
      this.logger.error(
        { cause: err instanceof Error ? err.name : 'unknown' },
        'auth0 user deletion failed',
      );
    }
  }

  private required(): GithubConnect {
    if (this.gh === null) throw new IntegrationUnavailableError('github connect not configured');
    return this.gh;
  }

  private async githubRow(userId: string): Promise<IntegrationRow | undefined> {
    const rows = await integrationsOf(this.dbs.db, userId);
    return rows.find((r) => r.integrationType === 'github');
  }

  /** GitHub's own word on the token; a 401 drops the cached token too. */
  private async githubUser(
    gh: GithubConnect,
    sub: string,
    found: GithubIdentity,
  ): Promise<GithubUser> {
    try {
      return await gh.github.authenticatedUser(found.token);
    } catch (err) {
      if (err instanceof GithubNotLinkedError) gh.tokens.forget(sub);
      throw err;
    }
  }

  /**
   * Deletes the grant at GitHub with the token Auth0 holds now: the cached one
   * is dropped first, because a stale token that GitHub already refuses would
   * read as "already gone" while a newer token stayed alive.
   */
  private async revoke(gh: GithubConnect, sub: string): Promise<void> {
    gh.tokens.forget(sub);
    const found = await gh.tokens.tokenFor(sub);
    // No GitHub identity at Auth0: there is no token left to revoke.
    if (found !== null) {
      const result = await gh.github.deleteGrant(
        gh.settings.githubClientId,
        gh.settings.githubClientSecret,
        found.token,
      );
      this.logger.info({ result }, 'github grant revoked');
    }
    gh.tokens.forget(sub);
  }

  /**
   * Sets the flag, the GitHub id and login, and `verified`, in one transaction
   * (plan §5.1), but only onto the version of the row the caller read
   * (`expected`, null for no row): otherwise 409 GITHUB_STATE_CHANGED and
   * nothing is written.
   */
  private async markConnected(
    userId: string,
    ghUser: GithubUser,
    expected: number | null,
  ): Promise<void> {
    await inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      const row = await lockGithubRow(trx, userId);
      if (versionOf(row) !== expected) throw stateChanged();
      try {
        await writeGithubRow(trx, userId, row, {
          status: 'connected',
          externalUserId: ghUser.id,
          externalLogin: ghUser.login,
        });
      } catch (err) {
        if (isMysqlError(err, MysqlErrno.DUPLICATE_KEY)) throw accountInUse();
        throw err;
      }
      await setUserVerified(trx, userId, true);
    });
  }

  /**
   * Clears the flag, the GitHub id and login, and puts `verified` back to the
   * email, in one transaction. Only onto the version the caller read and
   * revoked (`expected`): a connection made meanwhile, whose token was not
   * revoked, is not cleared (409 GITHUB_STATE_CHANGED); one already gone needs
   * nothing.
   */
  private async markDisconnected(
    userId: string,
    identity: AccessTokenIdentity,
    expected: number | null,
  ): Promise<void> {
    await inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      const locked = await lockGithubRow(trx, userId);
      const changed = versionOf(locked) !== expected;
      if (changed && locked !== undefined && locked.status !== 'not_connected') {
        throw stateChanged();
      }
      // Connected, or this disconnect's own revocation marker (unchanged since).
      if (locked?.status === 'connected' || (locked?.status === 'linking' && !changed)) {
        await writeGithubRow(
          trx,
          userId,
          locked,
          { status: 'not_connected', externalUserId: null, externalLogin: null },
          { clearSynced: true },
        );
      }
      // What GitHub offered is not the student's to answer any more (plan §6.6).
      await trx
        .deleteFrom('suggestions')
        .where('userId', '=', userId)
        .where('source', '=', 'github')
        .where('status', '=', 'open')
        .execute();
      // Back to the email alone (plan §5.1).
      await setUserVerified(trx, userId, identity.emailVerified);
    });
  }

  /**
   * Marks the connected row `linking` (keeping its GitHub id and login) for
   * the time GitHub is asked to delete the grant, and returns the version
   * written. Only onto the row as it was read (409 GITHUB_STATE_CHANGED).
   */
  private async beginRevocation(userId: string, read: IntegrationRow): Promise<number> {
    return inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      const row = await lockGithubRow(trx, userId);
      if (row?.status !== 'connected' || row.generation !== read.generation) {
        throw stateChanged();
      }
      return writeGithubRow(trx, userId, row, {
        status: 'linking',
        externalUserId: row.externalUserId,
        externalLogin: row.externalLogin,
      });
    });
  }

  /**
   * A revocation that failed changed nothing at GitHub: the row goes back to
   * connected, if it is still this disconnect's marker. A failure here is
   * logged, not thrown: the revocation's own error is what the caller needs,
   * and a marker left behind is settled from GitHub's word by `reconcile`.
   */
  private async abortRevocation(userId: string, generation: number): Promise<void> {
    try {
      await inTransaction(this.dbs.db, async (trx) => {
        await lockUser(trx, userId);
        const row = await lockGithubRow(trx, userId);
        if (row?.status !== 'linking' || row.generation !== generation) return;
        await writeGithubRow(trx, userId, row, {
          status: 'connected',
          externalUserId: row.externalUserId,
          externalLogin: row.externalLogin,
        });
        await setUserVerified(trx, userId, true);
      });
    } catch (err) {
      this.logger.warn(
        { userId, err: err instanceof Error ? err.name : 'unknown' },
        'abort failed',
      );
    }
  }

  /** Undoes this link's reservation, if it is still the one this request made. */
  private async releaseReservation(userId: string, githubUserId: string): Promise<void> {
    await inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      const row = await lockGithubRow(trx, userId);
      if (row?.status !== 'linking' || row.externalUserId !== githubUserId) return;
      await writeGithubRow(trx, userId, row, {
        status: 'not_connected',
        externalUserId: null,
        externalLogin: null,
      });
    });
  }

  /**
   * Settles a reservation whose Auth0 call has certainly ended (older than the
   * link deadline plus a margin) from Auth0's record: GitHub identity present
   * (and GitHub confirms the token) -> connected; absent -> released. A younger
   * reservation is never touched, so a link whose step 4 is still in flight is
   * not settled under it. Auth0 and GitHub are asked outside any transaction;
   * the write re-checks the row under the user lock, so two settlements agree.
   */
  private async reconcile(gh: GithubConnect, user: UserRow): Promise<void> {
    const age = {
      linkS: Math.ceil(gh.linkDeadlineMs / 1000) + RECONCILE_MARGIN_S,
      revokeS: Math.ceil(gh.revokeDeadlineMs / 1000) + RECONCILE_MARGIN_S,
    };
    const stale = await staleReservation(this.dbs.db, user.id, age);
    if (stale === undefined) return;

    let confirmed: GithubUser | undefined;
    const found = await gh.tokens.tokenFor(user.auth0Id);
    if (found !== null && found.githubUserId === stale.externalUserId) {
      try {
        const ghUser = await this.githubUser(gh, user.auth0Id, found);
        if (ghUser.id === stale.externalUserId) confirmed = ghUser;
      } catch (err) {
        // A token GitHub refuses cannot be connected: the reservation goes.
        if (!(err instanceof GithubNotLinkedError)) throw err;
      }
    }

    await inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, user.id);
      const still = await staleReservation(trx, user.id, age, { lock: true });
      if (still?.generation !== stale.generation) return;
      if (confirmed) {
        await writeGithubRow(trx, user.id, still, {
          status: 'connected',
          externalUserId: confirmed.id,
          externalLogin: confirmed.login,
        });
        await setUserVerified(trx, user.id, true);
      } else {
        // An abandoned revocation marker was a connection: its sync time goes with it.
        await writeGithubRow(
          trx,
          user.id,
          still,
          { status: 'not_connected', externalUserId: null, externalLogin: null },
          { clearSynced: isRevocationMarker(still) },
        );
      }
    });
    this.logger.info(
      { userId: user.id, connected: confirmed !== undefined },
      'github link settled',
    );
  }

  private async issueNonce(userId: string): Promise<ConnectResponse> {
    const nonce = randomBytes(32).toString('base64url');
    // Whole seconds: DATETIME stores no fraction.
    const expiresAt = new Date(
      Math.floor(Date.now() / 1000) * 1000 + this.cfg.INTEGRATION_NONCE_TTL_S * 1000,
    );
    await insertNonce(this.dbs.db, sha256(nonce), userId, expiresAt);
    return { state: 'link_required', nonce, expiresAt: expiresAt.toISOString() };
  }
}
