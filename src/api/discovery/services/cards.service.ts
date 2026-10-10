import { Injectable } from '@nestjs/common';
import { DbService } from '../../../core/db/db.service.js';
import { FileUrlService } from '../../files/services/file-url.service.js';
import { termsOf } from '../../projects/repositories/project-terms.repository.js';
import type { PersonSummary, ProjectCard } from '../dto/discovery.dto.js';
import { projectCountsOf, skillsOf } from '../repositories/search.repository.js';

/** Terms shown on a card; the full lists are on the project's own page. */
const CARD_TERMS = 5;

interface PersonRow {
  id: string;
  name: string;
  headline: string;
  avatarUrl: string | null;
  verified: boolean;
  location: string | null;
}

interface ProjectRow {
  id: string;
  title: string;
  summary: string | null;
  category: ProjectCard['category'];
  status: ProjectCard['status'];
  heroImageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  ownerId: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
}

/**
 * Rows of a page become cards: the page's children are read in a fixed number
 * of statements (never one per row) and every stored file URL becomes a signed
 * read URL, once per distinct URL (docs/m6-plan.md §4.2, §8).
 */
@Injectable()
export class CardsService {
  constructor(
    private readonly dbs: DbService,
    private readonly files: FileUrlService,
  ) {}

  private async sign(urls: readonly (string | null)[]): Promise<Map<string, string>> {
    const distinct = [...new Set(urls.filter((u): u is string => u !== null))];
    const signed = await Promise.all(distinct.map((u) => this.files.read(u)));
    return new Map(distinct.map((u, i) => [u, signed[i]!]));
  }

  /** Two statements: skills, and discoverable project counts. */
  async people(rows: readonly PersonRow[]): Promise<PersonSummary[]> {
    const { db } = this.dbs;
    const ids = rows.map((r) => r.id);
    const [skills, counts, urls] = await Promise.all([
      skillsOf(db, ids),
      projectCountsOf(db, ids),
      this.sign(rows.map((r) => r.avatarUrl)),
    ]);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      headline: r.headline,
      avatarUrl: r.avatarUrl === null ? null : (urls.get(r.avatarUrl) ?? r.avatarUrl),
      verified: r.verified,
      location: r.location,
      skills: skills.get(r.id) ?? [],
      projectCount: counts.get(r.id) ?? 0,
    }));
  }

  /** Two statements: technologies and tags. */
  async projects(rows: readonly ProjectRow[]): Promise<ProjectCard[]> {
    const { db } = this.dbs;
    const ids = rows.map((r) => r.id);
    const [technologies, tags, urls] = await Promise.all([
      termsOf(db, 'projectTechnologies', ids),
      termsOf(db, 'projectTags', ids),
      this.sign(rows.flatMap((r) => [r.heroImageUrl, r.ownerAvatarUrl])),
    ]);
    const url = (u: string | null) => (u === null ? null : (urls.get(u) ?? u));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      category: r.category,
      status: r.status,
      heroImageUrl: url(r.heroImageUrl),
      technologies: (technologies.get(r.id) ?? []).slice(0, CARD_TERMS),
      tags: (tags.get(r.id) ?? []).slice(0, CARD_TERMS),
      owner: { id: r.ownerId, name: r.ownerName, avatarUrl: url(r.ownerAvatarUrl) },
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
