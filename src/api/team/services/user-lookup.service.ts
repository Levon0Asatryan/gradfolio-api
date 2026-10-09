import { Injectable } from '@nestjs/common';
import { DbService } from '../../../core/db/db.service.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import { escapeLike } from '../../projects/repositories/project.repository.js';
import { lookupUsers } from '../repositories/team.repository.js';

/** The most people one lookup returns: enough to pick from, too few to harvest. */
export const LOOKUP_LIMIT = 8;

@Injectable()
export class UserLookupService {
  constructor(
    private readonly dbs: DbService,
    private readonly files: FileUrlService,
  ) {}

  /**
   * People to invite: public profiles whose name starts with `q`, never the
   * caller, never an email or any private column. Prefix only and at least
   * three characters (the DTO), a small page, and its own rate budget bound
   * what a caller can enumerate.
   */
  async lookup(callerId: string, q: string) {
    const rows = await lookupUsers(this.dbs.db, callerId, escapeLike(q), LOOKUP_LIMIT);
    return {
      items: await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          name: r.name,
          headline: r.headline,
          avatarUrl: await this.files.read(r.avatarUrl),
        })),
      ),
    };
  }
}
