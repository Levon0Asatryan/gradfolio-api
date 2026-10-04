import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { ProfileHeader, ProfileResponse, UpdateProfile } from '../dto/profile.dto.js';
import { listProfileProjects } from '../repositories/project-summary.repository.js';
import { findVisibleUser, toHeader, updateHeader } from '../repositories/profile.repository.js';
import {
  listCertifications,
  listEducation,
  listExperience,
  listSkills,
} from '../repositories/section.repository.js';

@Injectable()
export class ProfileService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
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
      listEducation(db, user.id),
      listExperience(db, user.id),
      listCertifications(db, user.id),
      listSkills(db, user.id),
      listProfileProjects(db, user.id, {
        viewerIsOwner: isOwner,
        limit: this.cfg.PROFILE_PROJECTS_LIMIT,
      }),
    ]);
    return {
      ...toHeader(user),
      verified: user.verified,
      isOwner,
      education,
      experience,
      certifications,
      skills,
      projects,
    };
  }

  /** The caller's own editable header. */
  async getHeader(userId: string): Promise<ProfileHeader> {
    const user = await findVisibleUser(this.dbs.db, userId, userId);
    if (user === undefined) throw new NotFoundError('profile');
    return toHeader(user);
  }

  /**
   * Applies `patch` to the caller's own row, then returns the header. 0 matched
   * rows (the account was deleted after the guard resolved it) is 404, not a
   * 200 for an account that no longer exists.
   */
  async updateHeader(userId: string, patch: UpdateProfile): Promise<ProfileHeader> {
    const matched = await updateHeader(this.dbs.db, userId, patch);
    if (matched === 0) throw new NotFoundError('profile');
    return this.getHeader(userId);
  }
}
