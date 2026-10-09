import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { ValidationError } from '../../../core/errors/app-error.js';
import { decodeTimeCursor, encodeTimeCursor } from '../../common/utils/time-cursor.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import type { MyTeams, MyTeamsQuery } from '../dto/my-teams.dto.js';
import type { TeamMember } from '../dto/team.dto.js';
import {
  listIncoming,
  listMemberships,
  listOutgoing,
  listOwnedTeamProjects,
  listTeamRowsOf,
} from '../repositories/my-teams.repository.js';

type Scope = 'owned' | 'member' | 'incoming' | 'outgoing';
const CURSOR_PARAM = {
  owned: 'ownedCursor',
  member: 'memberCursor',
  incoming: 'incomingCursor',
  outgoing: 'outgoingCursor',
} as const;

type TeamRow = Awaited<ReturnType<typeof listTeamRowsOf>>[number];

@Injectable()
export class MyTeamsService {
  constructor(
    private readonly dbs: DbService,
    private readonly files: FileUrlService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * The caller's teams in one call: four lists, each on its own cursor. Every
   * statement is scoped to the caller, and the number of statements does not
   * depend on how many projects or members there are (a page's members come
   * from one statement). What a row may show follows Q3/Q4: a pending
   * invitee gets the project's title and the inviter, never the project; a
   * linked person is named and shown live only while their profile is visible
   * to the caller.
   */
  async get(userId: string, query: MyTeamsQuery): Promise<MyTeams> {
    const limit = query.limit ?? this.cfg.TEAMS_PAGE_SIZE;
    if (limit > this.cfg.TEAMS_PAGE_MAX) {
      throw new ValidationError([
        { path: 'limit', message: `must be at most ${this.cfg.TEAMS_PAGE_MAX}` },
      ]);
    }
    const cursors = {
      owned: this.cursor(query, 'owned'),
      member: this.cursor(query, 'member'),
      incoming: this.cursor(query, 'incoming'),
      outgoing: this.cursor(query, 'outgoing'),
    };
    const [owned, member, incoming, outgoing] = await Promise.all([
      this.owned(userId, cursors.owned, limit),
      this.member(userId, cursors.member, limit),
      this.incoming(userId, cursors.incoming, limit),
      this.outgoing(userId, cursors.outgoing, limit),
    ]);
    return { owned, member, incoming, outgoing };
  }

  private cursor(query: MyTeamsQuery, scope: Scope) {
    const raw = query[CURSOR_PARAM[scope]];
    if (raw === undefined) return undefined;
    const decoded = decodeTimeCursor(raw, scope);
    if (decoded === undefined) {
      throw new ValidationError([
        { path: CURSOR_PARAM[scope], message: 'is not a cursor for this list' },
      ]);
    }
    return decoded;
  }

  private next<T extends { createdAt: Date }>(
    scope: Scope,
    rows: T[],
    shown: T[],
    limit: number,
    idOf: (r: T) => string,
  ): string | null {
    const last = shown.at(-1);
    return rows.length > limit && last !== undefined
      ? encodeTimeCursor({ t: last.createdAt.getTime(), id: idOf(last) }, scope)
      : null;
  }

  private async owned(userId: string, cursor: ReturnType<MyTeamsService['cursor']>, limit: number) {
    const { db } = this.dbs;
    const rows = await listOwnedTeamProjects(db, userId, cursor, limit);
    const shown = rows.slice(0, limit);
    const team = await this.teamsOf(
      shown.map((p) => p.id),
      userId,
      false,
    );
    return {
      items: shown.map((p) => ({
        id: p.id,
        title: p.title,
        isPublic: p.isPublic,
        isDraft: p.isDraft,
        members: team.get(p.id) ?? [],
      })),
      nextCursor: this.next('owned', rows, shown, limit, (p) => p.id),
    };
  }

  private async member(
    userId: string,
    cursor: ReturnType<MyTeamsService['cursor']>,
    limit: number,
  ) {
    const { db } = this.dbs;
    const rows = await listMemberships(db, userId, cursor, limit);
    const shown = rows.slice(0, limit);
    const team = await this.teamsOf(
      shown.map((m) => m.projectId),
      userId,
      true,
    );
    return {
      items: await Promise.all(
        shown.map(async (m) => {
          const ownerVisible = m.ownerIsPublic || m.ownerId === userId;
          return {
            id: m.projectId,
            title: m.title,
            isPublic: m.isPublic,
            role: m.role,
            joinedAt: m.createdAt.toISOString(),
            owner: {
              id: ownerVisible ? m.ownerId : null,
              name: m.ownerName,
              avatarUrl: ownerVisible ? await this.files.read(m.ownerAvatarUrl) : null,
            },
            team: team.get(m.projectId) ?? [],
          };
        }),
      ),
      nextCursor: this.next('member', rows, shown, limit, (m) => m.memberId),
    };
  }

  private async incoming(
    userId: string,
    cursor: ReturnType<MyTeamsService['cursor']>,
    limit: number,
  ) {
    const rows = await listIncoming(this.dbs.db, userId, cursor, limit);
    const shown = rows.slice(0, limit);
    return {
      items: shown.map((r) => ({
        id: r.memberId,
        project: { id: r.projectId, title: r.title },
        role: r.role,
        invitedAt: r.createdAt.toISOString(),
        invitedBy: { id: r.ownerIsPublic ? r.ownerId : null, name: r.ownerName },
      })),
      nextCursor: this.next('incoming', rows, shown, limit, (r) => r.memberId),
    };
  }

  private async outgoing(
    userId: string,
    cursor: ReturnType<MyTeamsService['cursor']>,
    limit: number,
  ) {
    const rows = await listOutgoing(this.dbs.db, userId, cursor, limit);
    const shown = rows.slice(0, limit);
    return {
      items: await Promise.all(
        shown.map(async (r) => {
          const visible = r.userId !== null && r.inviteeIsPublic === true;
          return {
            id: r.memberId,
            project: { id: r.projectId, title: r.title },
            invitee: {
              id: visible ? r.userId : null,
              name: visible && r.liveName !== null ? r.liveName : r.name,
              avatarUrl: visible ? await this.files.read(r.liveAvatarUrl) : null,
            },
            role: r.role,
            invitedAt: r.createdAt.toISOString(),
          };
        }),
      ),
      nextCursor: this.next('outgoing', rows, shown, limit, (r) => r.memberId),
    };
  }

  /** The members of a page of projects, grouped by project, from one statement. */
  private async teamsOf(projectIds: string[], viewerId: string, acceptedOnly: boolean) {
    const byProject = new Map<string, TeamMember[]>();
    if (projectIds.length === 0) return byProject;
    const rows = await listTeamRowsOf(this.dbs.db, projectIds, acceptedOnly);
    const members = await Promise.all(rows.map((r) => this.present(r, viewerId)));
    rows.forEach((r, i) =>
      byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), members[i]!]),
    );
    return byProject;
  }

  private async present(r: TeamRow, viewerId: string): Promise<TeamMember> {
    const visible = r.userId !== null && (r.memberIsPublic === true || r.userId === viewerId);
    return {
      id: r.id,
      name: visible && r.liveName !== null ? r.liveName : r.name,
      role: r.role,
      status: r.status,
      userId: visible ? r.userId : null,
      avatarUrl: await this.files.read(
        visible ? r.liveAvatarUrl : r.userId === null ? r.avatarUrl : null,
      ),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
