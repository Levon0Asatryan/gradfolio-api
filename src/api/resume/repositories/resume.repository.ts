import type { Database } from '../../../core/db/database.js';
import { AppError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { certificationSection } from '../../profiles/repositories/certification.repository.js';
import { educationSection } from '../../profiles/repositories/education.repository.js';
import { experienceSection } from '../../profiles/repositories/experience.repository.js';
import { findVisibleUser } from '../../profiles/repositories/profile.repository.js';
import { listSkills } from '../../profiles/repositories/skill.repository.js';
import type { ResumeRequest } from '../dto/resume.dto.js';
import { RESUME_LABELS, type ResumeData, resumeUrl } from '../utils/resume-data.js';

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
      const data: ResumeData = { name: user.name, headline: user.headline, blocks: [] };
      const add = (key: keyof typeof labels, entries: ResumeData['blocks'][number]['entries']) => {
        if (entries.length) data.blocks.push({ title: labels[key], entries });
      };
      const selected = new Set(input.sections);
      if (selected.has('contact')) {
        const entries: ResumeData['blocks'][number]['entries'] = [];
        if (user.contactEmail) entries.push({ text: user.contactEmail });
        if (user.location) entries.push({ text: user.location });
        for (const value of [user.website, user.github, user.linkedin, user.twitter]) {
          const url = resumeUrl(value);
          if (url) entries.push({ text: url, url });
        }
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
        if (input.projectIds && projects.length !== input.projectIds.length)
          throw new NotFoundError('project');
        if (projects.length > maxProjects)
          throw new AppError('RESUME_TOO_LARGE', 'select fewer projects', 422);
        add(
          'projects',
          projects.map((p) => ({
            title: p.title,
            text: p.summary ?? '',
            url: resumeUrl(p.liveDemoUrl) ?? resumeUrl(p.repoUrl),
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
            url: resumeUrl(c.credentialUrl),
          })),
        );
      return data;
    });
}
