import type { Database } from '../../../core/db/database.js';
import { AppError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { certificationSection } from '../../profiles/repositories/certification.repository.js';
import { educationSection } from '../../profiles/repositories/education.repository.js';
import { experienceSection } from '../../profiles/repositories/experience.repository.js';
import { findVisibleUser } from '../../profiles/repositories/profile.repository.js';
import { listSkills } from '../../profiles/repositories/skill.repository.js';
import type { ResumeRequest, ResumeSection } from '../dto/resume.dto.js';
import { ResumeBuilder, type ResumeEntryInput } from '../utils/resume-builder.js';
import { RESUME_LABELS, type ResumeData } from '../utils/resume-data.js';

export async function snapshotResume(
  db: Database,
  maxProjects: number,
  userId: string,
  input: ResumeRequest,
): Promise<ResumeData> {
  if ((input.projectIds?.length ?? 0) > maxProjects) {
    throw new ValidationError([{ path: 'projectIds', message: 'too many projects' }]);
  }
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      const user = await findVisibleUser(trx, userId, userId);
      if (!user) throw new NotFoundError('profile');
      const labels = RESUME_LABELS[input.language];
      const resume = new ResumeBuilder(user.name, user.headline);
      const built = new Map<ResumeSection, readonly ResumeEntryInput[]>();
      const add = (key: ResumeSection, entries: readonly ResumeEntryInput[]) => {
        if (entries.length) built.set(key, entries);
      };
      const selected = new Set(input.sections);
      if (selected.has('contact')) {
        const entries: ResumeEntryInput[] = [];
        if (user.contactEmail) entries.push({ text: user.contactEmail });
        if (user.location) entries.push({ text: user.location });
        for (const link of [user.website, user.github, user.linkedin, user.twitter])
          entries.push({ link });
        add('contact', entries);
      }
      if (selected.has('bio') && user.bio) add('bio', [{ text: user.bio }]);
      if (selected.has('education'))
        add(
          'education',
          (await educationSection.list(trx, userId)).map((e) => ({
            title: `${e.degree} · ${e.field}`,
            text: [
              e.institution,
              `${e.startYear} - ${e.endYear ?? labels.present}`,
              e.description,
              ...e.highlights,
            ]
              .filter(Boolean)
              .join('\n'),
          })),
        );
      if (selected.has('experience'))
        add(
          'experience',
          (await experienceSection.list(trx, userId)).map((e) => ({
            title: `${e.title} · ${e.organization}`,
            text: [`${e.start} - ${e.end ?? labels.present}`, e.summary, ...e.achievements]
              .filter(Boolean)
              .join('\n'),
          })),
        );
      if (selected.has('projects') && input.projectIds?.length !== 0) {
        const projects = await trx
          .selectFrom('projects as p')
          .select(['p.id', 'p.title', 'p.summary', 'p.repoUrl', 'p.liveDemoUrl'])
          .where((eb) =>
            eb.or([
              eb.and([
                eb('p.userId', '=', userId),
                ...(input.includePrivateProjects && input.projectIds !== undefined
                  ? []
                  : [eb('p.isPublic', '=', true), eb('p.isDraft', '=', false)]),
              ]),
              eb.and([
                eb('p.isPublic', '=', true),
                eb('p.isDraft', '=', false),
                eb.exists(
                  eb
                    .selectFrom('projectTeamMembers as m')
                    .select('m.id')
                    .whereRef('m.projectId', '=', 'p.id')
                    .where('m.userId', '=', userId)
                    .where('m.status', '=', 'accepted'),
                ),
              ]),
            ]),
          )
          .$if(input.projectIds !== undefined, (q) => q.where('p.id', 'in', input.projectIds!))
          .orderBy('p.createdAt', 'desc')
          .orderBy('p.id')
          .limit(maxProjects + 1)
          .execute();
        // Explicit ids: the client's order wins. Without ids: newest first (the query's order).
        if (input.projectIds) {
          const rank = new Map(input.projectIds.map((id, i) => [id, i]));
          projects.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
        }
        if (input.projectIds && projects.length !== input.projectIds.length)
          throw new NotFoundError('project');
        if (projects.length > maxProjects)
          throw new AppError('RESUME_TOO_LARGE', 'select fewer projects', 422);
        add(
          'projects',
          projects.map((p) => ({
            title: p.title,
            text: p.summary ?? '',
            urls: [p.liveDemoUrl, p.repoUrl],
          })),
        );
      }
      if (selected.has('skills')) {
        const skills = await listSkills(trx, userId);
        if (skills.length) add('skills', [{ text: skills.join(', ') }]);
      }
      if (selected.has('certifications'))
        add(
          'certifications',
          (await certificationSection.list(trx, userId)).map((c) => ({
            title: c.name,
            text: `${c.issuer} · ${c.date}`,
            urls: [c.credentialUrl],
          })),
        );
      for (const section of input.sections) {
        const entries = built.get(section);
        if (entries) resume.section(labels[section], entries);
      }
      return resume.build();
    });
}
