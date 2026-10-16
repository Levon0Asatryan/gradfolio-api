import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import type { DB } from '../../../core/db/types.generated.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { lockUser } from '../../../core/db/user-lock.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import type { ProfileHeader, ProfileResponse, UpdateProfile } from '../dto/profile.dto.js';
import { listProfileProjects } from '../repositories/project-summary.repository.js';
import { findVisibleUser, toHeader, updateHeader } from '../repositories/profile.repository.js';
import { certificationSection } from '../repositories/certification.repository.js';
import { educationSection } from '../repositories/education.repository.js';
import { experienceSection } from '../repositories/experience.repository.js';
import { listSkills } from '../repositories/skill.repository.js';

@Injectable()
export class ProfileService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly files: FileUrlService,
  ) {}

  /**
   * A profile as `viewerId` (undefined: anonymous) may see it. A profile the
   * viewer may not read is "not found", the same answer as for an id that does
   * not exist.
   */
  async getProfile(id: string, viewerId: string | undefined): Promise<ProfileResponse> {
    const { db } = this.dbs;
    const user = await findVisibleUser(db, id, viewerId);
    if (user === undefined) throw new NotFoundError('profile');

    const isOwner = viewerId !== undefined && viewerId === user.id;
    const [education, experience, certifications, skills, projects] = await Promise.all([
      educationSection.list(db, user.id),
      experienceSection.list(db, user.id),
      certificationSection.list(db, user.id),
      listSkills(db, user.id),
      listProfileProjects(db, user.id, {
        viewerIsOwner: isOwner,
        limit: this.cfg.PROFILE_PROJECTS_LIMIT,
      }),
    ]);
    return {
      ...toHeader(user),
      avatarUrl: await this.files.read(user.avatarUrl),
      verified: user.verified,
      isOwner,
      education,
      experience,
      certifications,
      skills,
      projects: await Promise.all(
        projects.map(async (p) => ({ ...p, heroImageUrl: await this.files.read(p.heroImageUrl) })),
      ),
    };
  }

  /** The caller's own editable header. */
  async getHeader(userId: string): Promise<ProfileHeader> {
    const user = await findVisibleUser(this.dbs.db, userId, userId);
    if (user === undefined) throw new NotFoundError('profile');
    return { ...toHeader(user), avatarUrl: await this.files.read(user.avatarUrl) };
  }

  /**
   * Applies `patch` to the caller's own row, then returns the header. 0 matched
   * rows (the account was deleted after the guard resolved it) is 404, not a
   * 200 for an account that no longer exists.
   */
  async updateHeader(userId: string, patch: UpdateProfile): Promise<ProfileHeader> {
    if (patch.avatarUrl === undefined) {
      const matched = await updateHeader(this.dbs.db, userId, patch);
      if (matched === 0) throw new NotFoundError('profile');
      return this.getHeader(userId);
    }
    const memo: AvatarMemo = {};
    const released = await inTransaction(this.dbs.db, (trx) =>
      this.applyAvatarPatch(trx, userId, patch, memo),
    );
    await this.files.release(released);
    return this.getHeader(userId);
  }

  /**
   * The same write inside a transaction the caller owns (a suggestion's accept
   * changes the field and the suggestion together). Takes the user lock itself;
   * returns the stored file keys the change released: pass them to
   * `releaseFiles` **after** the commit. `memo` is remembered across a deadlock
   * retry, which reruns the caller's body.
   */
  async applyHeaderIn(
    trx: Transaction<DB>,
    userId: string,
    patch: UpdateProfile,
    memo: AvatarMemo = {},
  ): Promise<string[]> {
    if (patch.avatarUrl === undefined) {
      await lockUser(trx, userId);
      const matched = await updateHeader(trx, userId, patch);
      if (matched === 0) throw new NotFoundError('profile');
      return [];
    }
    return this.applyAvatarPatch(trx, userId, patch, memo);
  }

  /** Deletes what a committed change released (a failed delete is logged and swept later). */
  releaseFiles(keys: string[]): Promise<void> {
    return this.files.release(keys);
  }

  /**
   * A new avatar may be an uploaded file: register it, and delete the one it
   * replaces after the commit. Under the user lock, so two avatar changes
   * cannot both believe the other's file is the old one.
   */
  private async applyAvatarPatch(
    trx: Transaction<DB>,
    userId: string,
    patch: UpdateProfile,
    memo: AvatarMemo,
  ): Promise<string[]> {
    const requested = patch.avatarUrl as string | null;
    await lockUser(trx, userId);
    const current = await trx
      .selectFrom('users')
      .select('avatarUrl')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const sameFile =
      requested !== null &&
      (requested === current.avatarUrl ||
        (this.files.keyOf(requested) !== null &&
          this.files.keyOf(requested) === this.files.keyOf(current.avatarUrl)));
    memo.registered ??=
      requested === null || sameFile ? undefined : this.files.accept(userId, requested, 'avatar');
    const avatarUrl =
      requested === null ? null : sameFile ? current.avatarUrl : await memo.registered!;
    const matched = await updateHeader(trx, userId, { ...patch, avatarUrl });
    if (matched === 0) throw new NotFoundError('profile');
    const kept = this.files.keysOf([avatarUrl]);
    return this.files.keysOf([current.avatarUrl]).filter((k) => !kept.includes(k));
  }
}

/** A registered avatar, remembered across a deadlock retry of the transaction that registered it. */
export interface AvatarMemo {
  registered?: Promise<string>;
}
