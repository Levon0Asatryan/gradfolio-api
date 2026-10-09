import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { newId } from '../../../core/db/ids.js';
import { isMysqlError, MysqlErrno } from '../../../core/db/mysql-errors.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import { insertTeamNotification } from '../../notifications/repositories/notification-write.repository.js';
import type { UserRow } from '../../users/repositories/user.repository.js';
import { type AddExternalMember, type InviteMember, type TeamMember } from '../dto/team.dto.js';
import {
  answerInvite,
  countMembers,
  deleteMember,
  deleteOwnAcceptedMember,
  findPublicUser,
  insertMember,
  lockMemberOfUser,
  lockOwnedProject,
  lockProjectShared,
  type MemberRow,
  readMember,
  renewInvite,
} from '../repositories/team.repository.js';

/**
 * Team writes. Each is one transaction: the project lock (ownership checked in
 * that statement for the owner's writes), the member row, the change, and the
 * notification -- so a rollback leaves neither (docs/m5-plan.md §4, §5).
 *
 * `inTransaction` reruns a body after a deadlock, so each body is repeatable:
 * it reads what it needs under the locks and writes once.
 */
@Injectable()
export class TeamWriteService {
  constructor(
    private readonly dbs: DbService,
    private readonly files: FileUrlService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Owner invites a user with a public profile; a rejected user is invited again by UPDATE (D6). */
  async invite(owner: UserRow, projectId: string, input: InviteMember): Promise<TeamMember> {
    const member = await this.mapDuplicates(() =>
      inTransaction(this.dbs.db, async (trx) => {
        const project = await lockOwnedProject(trx, owner.id, projectId);
        if (project === undefined) throw new NotFoundError('project');
        if (input.userId === owner.id) {
          // The caller is the owner here: one rule covers "invite yourself" and "invite the owner".
          throw new ValidationError([{ path: 'userId', message: 'you cannot invite yourself' }]);
        }
        if (project.isDraft) {
          throw new ConflictError('PROJECT_IS_DRAFT', 'a draft cannot have invitations');
        }
        // A private profile answers exactly like an unknown id.
        const invitee = await findPublicUser(trx, input.userId);
        if (invitee === undefined) throw new NotFoundError('user');

        const existing = await lockMemberOfUser(trx, projectId, invitee.id);
        let memberId: string;
        if (existing === undefined) {
          await this.requireRoom(trx, projectId);
          memberId = newId();
          await insertMember(trx, {
            id: memberId,
            projectId,
            userId: invitee.id,
            name: invitee.name,
            role: input.role,
            status: 'pending',
          });
        } else if (existing.status === 'rejected') {
          memberId = existing.id;
          const matched = await renewInvite(trx, projectId, invitee.id, {
            name: invitee.name,
            role: input.role,
          });
          if (matched === 0) throw new ConflictError('ALREADY_MEMBER', 'already on the team');
        } else {
          throw new ConflictError('ALREADY_MEMBER', 'already invited or on the team');
        }
        await insertTeamNotification(trx, {
          userId: invitee.id,
          type: 'team_invite',
          actor: owner,
          project,
          role: input.role,
        });
        return { row: await readMember(trx, memberId), avatarUrl: invitee.avatarUrl };
      }),
    );
    return this.present(member.row, member.row.userId, member.avatarUrl);
  }

  /** Owner adds a teammate who has no account: accepted at once, nobody to notify. */
  async addExternal(
    ownerId: string,
    projectId: string,
    input: AddExternalMember,
  ): Promise<TeamMember> {
    const row = await inTransaction(this.dbs.db, async (trx) => {
      if ((await lockOwnedProject(trx, ownerId, projectId)) === undefined) {
        throw new NotFoundError('project');
      }
      await this.requireRoom(trx, projectId);
      const id = newId();
      await insertMember(trx, {
        id,
        projectId,
        userId: null,
        name: input.name,
        role: input.role,
        status: 'accepted',
      });
      return readMember(trx, id);
    });
    return this.present(row, null, null);
  }

  /** Owner removes any membership of their project: pending, accepted, rejected or external. */
  async remove(ownerId: string, projectId: string, memberId: string): Promise<void> {
    await inTransaction(this.dbs.db, async (trx) => {
      if ((await lockOwnedProject(trx, ownerId, projectId)) === undefined) {
        throw new NotFoundError('project');
      }
      if ((await deleteMember(trx, projectId, memberId)) === 0) throw new NotFoundError('member');
    });
  }

  accept(user: UserRow, projectId: string): Promise<TeamMember> {
    return this.answer(user, projectId, 'accepted');
  }

  reject(user: UserRow, projectId: string): Promise<TeamMember> {
    return this.answer(user, projectId, 'rejected');
  }

  /**
   * The invitee answers. Project row `FOR SHARE` first (the owner's removal
   * holds it exclusively, so one of the two wins and the other sees the
   * result), then the caller's own row: someone with no row, or a row that is
   * not theirs, is 404; one that is not pending is 409 `INVITE_NOT_PENDING`.
   */
  private async answer(
    user: UserRow,
    projectId: string,
    status: 'accepted' | 'rejected',
  ): Promise<TeamMember> {
    const row = await inTransaction(this.dbs.db, async (trx) => {
      const project = await lockProjectShared(trx, projectId);
      if (project === undefined) throw new NotFoundError('project');
      const mine = await lockMemberOfUser(trx, projectId, user.id);
      if (mine === undefined) throw new NotFoundError('invitation');
      if (mine.status !== 'pending') {
        throw new ConflictError('INVITE_NOT_PENDING', 'the invitation is not pending');
      }
      if ((await answerInvite(trx, mine.id, { status, name: user.name })) === 0) {
        throw new ConflictError('INVITE_NOT_PENDING', 'the invitation is not pending');
      }
      await insertTeamNotification(trx, {
        userId: project.userId,
        type: status === 'accepted' ? 'team_accepted' : 'team_rejected',
        actor: user,
        project,
        role: mine.role,
      });
      return readMember(trx, mine.id);
    });
    return this.present(row, user.id, user.avatarUrl);
  }

  /** An accepted teammate takes themselves off the team; the owner is told. */
  async leave(user: UserRow, projectId: string): Promise<void> {
    await inTransaction(this.dbs.db, async (trx) => {
      const project = await lockProjectShared(trx, projectId);
      if (project === undefined) throw new NotFoundError('project');
      const mine = await lockMemberOfUser(trx, projectId, user.id);
      // A pending invitee uses reject; a rejected one has nothing to leave.
      if (mine?.status !== 'accepted') throw new NotFoundError('membership');
      if ((await deleteOwnAcceptedMember(trx, mine.id, user.id)) === 0) {
        throw new NotFoundError('membership');
      }
      await insertTeamNotification(trx, {
        userId: project.userId,
        type: 'team_left',
        actor: user,
        project,
        role: mine.role,
      });
    });
  }

  private async requireRoom(
    trx: Parameters<typeof countMembers>[0],
    projectId: string,
  ): Promise<void> {
    if ((await countMembers(trx, projectId)) >= this.cfg.PROJECT_MAX_TEAM) {
      throw new ConflictError('TEAM_FULL', `at most ${this.cfg.PROJECT_MAX_TEAM} team members`);
    }
  }

  /**
   * The project lock already serialises invitations, so these two errors are
   * backstops, not the mechanism: a duplicate key is "already a member", and a
   * foreign key that vanished is an invitee who deleted their account in the
   * meantime -- the same 404 as a user who never existed.
   */
  private async mapDuplicates<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (isMysqlError(err, MysqlErrno.DUPLICATE_KEY)) {
        throw new ConflictError('ALREADY_MEMBER', 'already invited or on the team');
      }
      if (isMysqlError(err, MysqlErrno.FOREIGN_KEY_MISSING)) throw new NotFoundError('user');
      throw err;
    }
  }

  private async present(
    row: Pick<MemberRow, 'id' | 'name' | 'role' | 'status' | 'userId' | 'createdAt'>,
    userId: string | null,
    avatarUrl: string | null,
  ): Promise<TeamMember> {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      status: row.status,
      userId,
      avatarUrl: await this.files.read(avatarUrl),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
