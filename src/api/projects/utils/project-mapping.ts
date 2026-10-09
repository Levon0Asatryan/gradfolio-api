import type { ProjectDetail, ProjectSummary } from '../dto/project.dto.js';
import type { ProjectDetailRow, ProjectSummaryRow } from '../repositories/project.repository.js';
import { parseVideo } from './video.js';

export function toSummary(
  row: ProjectSummaryRow,
  terms: { tags: string[]; technologies: string[] },
  viewerId: string | undefined,
  /** Whose list this is: `member` for a project they are on but do not own. Default: the owner. */
  subjectId: string = row.userId,
): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    status: row.status,
    heroImageUrl: row.heroImageUrl,
    tags: terms.tags,
    role: row.userId === subjectId ? 'owner' : 'member',
    technologies: terms.technologies,
    isPublic: row.isPublic,
    isDraft: row.isDraft,
    isOwner: viewerId !== undefined && viewerId === row.userId,
    ownerId: row.userId,
    metadata: {
      startDate: row.metaStartDate,
      endDate: row.metaEndDate,
      course: row.metaCourse,
      professor: row.metaProfessor,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface Children {
  attachments: {
    id: string;
    type: 'image' | 'video' | 'pdf' | 'link';
    url: string;
    title: string | null;
    thumbnailUrl: string | null;
  }[];
  team: {
    id: string;
    name: string;
    role: string | null;
    avatarUrl: string | null;
    userId: string | null;
    memberVisible: boolean;
  }[];
  tags: string[];
  technologies: string[];
}

export function toDetail(
  row: ProjectDetailRow,
  children: Children,
  viewerId: string | undefined,
  videoHosts: readonly string[],
): ProjectDetail {
  const isOwner = viewerId !== undefined && viewerId === row.userId;
  return {
    ...toSummary(row, children, viewerId),
    aiSummary: row.aiSummary,
    descriptionHtml: row.descriptionHtml,
    liveDemoUrl: row.liveDemoUrl,
    repo: {
      url: row.repoUrl,
      latestCommitDate: row.repoLatestCommit,
      readmeUrl: row.repoReadmeUrl,
      stars: row.repoStars,
      forks: row.repoForks,
      language: row.repoLanguage,
    },
    links: row.links ?? [],
    files: row.files ?? [],
    attachments: children.attachments.map((a) => toAttachment(a, videoHosts)),
    team: children.team.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      // The photo is the member's own; it follows their profile's visibility.
      avatarUrl: m.userId === null || m.memberVisible ? m.avatarUrl : null,
      userId: m.memberVisible ? m.userId : null,
    })),
    owner: {
      id: row.userId,
      name: row.ownerName,
      avatarUrl: row.ownerIsPublic || isOwner ? row.ownerAvatarUrl : null,
    },
    source: row.source,
  };
}

/** An attachment as the API shows it: a video gets its embed URL, and a thumbnail if none is stored. */
export function toAttachment(
  a: {
    id: string;
    type: 'image' | 'video' | 'pdf' | 'link';
    url: string;
    title: string | null;
    thumbnailUrl: string | null;
  },
  videoHosts: readonly string[],
) {
  const video = a.type === 'video' ? parseVideo(a.url, videoHosts) : null;
  return {
    id: a.id,
    type: a.type,
    url: a.url,
    title: a.title,
    thumbnailUrl: a.thumbnailUrl ?? video?.thumbnailUrl ?? null,
    embedUrl: video?.embedUrl ?? null,
  };
}
