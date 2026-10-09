import type { Database } from '../database.js';
import { newId } from '../ids.js';
import { toJsonColumn } from '../json.js';
import { setProjectTerms, setUserSkills } from '../terms.js';
import { inTransaction } from '../transaction.js';
import {
  linkList,
  notificationParams,
  stringList,
  translationParams,
} from '../../validation/json-shapes.js';
import { termList } from '../../validation/terms.js';
import { activities, integrations, notifications, projects, SEED_USERS, users } from './data.js';

const highlightList = stringList({ maxItems: 20 });
const skillList = termList({ maxItems: 50 });
const links = linkList({ maxItems: 20 });

/**
 * Loads the demo data in one transaction: first deletes the seed's own users
 * by their fixed ids (everything else of theirs cascades), then inserts. A
 * re-run therefore gives the same rows, and nobody else's rows are touched.
 * JSON goes through `toJsonColumn`, terms through `setUserSkills` /
 * `setProjectTerms`: the same rules as the application.
 */
export async function seed(db: Database): Promise<void> {
  await inTransaction(db, async (trx) => {
    await trx.deleteFrom('users').where('id', 'in', Object.values(SEED_USERS)).execute();

    for (const u of users) {
      await trx
        .insertInto('users')
        .values({
          id: u.id,
          auth0Id: u.auth0Id,
          name: u.name,
          headline: u.headline,
          location: u.location,
          bio: u.bio,
          email: u.email,
          contactEmail: u.email,
          onboardedAt: new Date(),
          avatarUrl: u.avatarUrl,
          github: u.github,
          linkedin: u.linkedin,
          website: u.website,
          isPublic: u.isPublic,
          verified: u.verified,
        })
        .execute();
      for (const [sortOrder, e] of u.education.entries()) {
        await trx
          .insertInto('education')
          .values({
            id: newId(),
            userId: u.id,
            institution: e.institution,
            degree: e.degree,
            field: e.field,
            startYear: e.startYear,
            endYear: e.endYear,
            description: e.description,
            highlights: toJsonColumn(highlightList, e.highlights),
            sortOrder,
          })
          .execute();
      }
      for (const [sortOrder, e] of u.experience.entries()) {
        await trx
          .insertInto('experience')
          .values({
            id: newId(),
            userId: u.id,
            title: e.title,
            organization: e.organization,
            start: e.start,
            end: e.end,
            summary: e.summary,
            achievements: toJsonColumn(highlightList, e.achievements),
            skills: toJsonColumn(skillList, e.skills),
            sortOrder,
          })
          .execute();
      }
      for (const [sortOrder, c] of u.certifications.entries()) {
        await trx
          .insertInto('certifications')
          .values({ id: newId(), userId: u.id, ...c, sortOrder })
          .execute();
      }
      await setUserSkills(trx, u.id, u.skills);
    }

    for (const p of projects) {
      const { id, owner, technologies, tags, attachments, team, ...columns } = p;
      await trx
        .insertInto('projects')
        .values({
          ...columns,
          id,
          userId: owner,
          links: toJsonColumn(links, p.links),
          files: toJsonColumn(links, p.files),
        })
        .execute();
      await setProjectTerms(trx, id, 'technologies', technologies);
      await setProjectTerms(trx, id, 'tags', tags);
      for (const [sortOrder, a] of attachments.entries()) {
        await trx
          .insertInto('projectAttachments')
          .values({ id: newId(), projectId: id, ...a, sortOrder })
          .execute();
      }
      for (const [sortOrder, m] of team.entries()) {
        await trx
          .insertInto('projectTeamMembers')
          .values({
            id: newId(),
            projectId: id,
            userId: m.user,
            name: m.name,
            role: m.role,
            status: m.status,
            sortOrder,
          })
          .execute();
      }
    }

    for (const n of notifications) {
      await trx
        .insertInto('notifications')
        .values({
          id: newId(),
          userId: n.user,
          type: n.type,
          title: n.title,
          message: n.message,
          params: toJsonColumn(notificationParams, { ...n.params, projectId: n.project }),
          isRead: n.isRead,
          referenceId: n.project,
          referenceType: 'project',
          link: `/projects/${n.project}`,
        })
        .execute();
    }

    for (const a of activities) {
      await trx
        .insertInto('activities')
        .values({
          id: newId(),
          userId: a.user,
          type: a.type,
          translationKey: a.translationKey,
          translationParams: toJsonColumn(translationParams, a.translationParams),
          timestamp: new Date(a.timestamp),
        })
        .execute();
    }

    for (const i of integrations) {
      await trx
        .insertInto('integrations')
        .values({
          id: newId(),
          userId: i.user,
          integrationType: i.type,
          status: i.status,
          lastSyncedAt: i.lastSyncedAt === null ? null : new Date(i.lastSyncedAt),
        })
        .execute();
    }
  });
}
