import { Injectable } from '@nestjs/common';
import { DbService } from '../../../core/db/db.service.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import { listTeam } from '../../projects/repositories/project.repository.js';
import type { TeamList } from '../dto/team.dto.js';
import { findOwnedProjectId } from '../repositories/team.repository.js';

@Injectable()
export class TeamService {
  constructor(
    private readonly dbs: DbService,
    private readonly files: FileUrlService,
  ) {}

  /**
   * The owner's management view: every row, every status. Anyone else -- an
   * accepted teammate included -- gets 404, the answer for an unknown project.
   */
  async listForOwner(userId: string, projectId: string): Promise<TeamList> {
    const { db } = this.dbs;
    if ((await findOwnedProjectId(db, userId, projectId)) === undefined) {
      throw new NotFoundError('project');
    }
    const rows = await listTeam(db, projectId, userId, { acceptedOnly: false });
    return {
      items: await Promise.all(
        rows.map(async (m) => ({
          id: m.id,
          name: m.name,
          role: m.role,
          status: m.status,
          userId: m.memberVisible ? m.userId : null,
          avatarUrl: await this.files.read(m.avatarUrl),
          createdAt: m.createdAt.toISOString(),
        })),
      ),
    };
  }
}
