import type { Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import { toJsonColumn } from '../../../core/db/json.js';
import { canonicalizeTerms } from '../../../core/db/terms.js';
import type { DB } from '../../../core/db/types.generated.js';
import { stringList } from '../../../core/validation/json-shapes.js';
import {
  type CreateExperience,
  MAX_ACHIEVEMENTS,
  MAX_EXPERIENCE_SKILLS,
} from '../dto/section.dto.js';
import type { SectionDefinition } from './section-definition.js';

const COLUMNS = [
  'id',
  'title',
  'organization',
  'start',
  'end',
  'summary',
  'achievements',
  'skills',
] as const;

const achievements = stringList({ maxItems: MAX_ACHIEVEMENTS });
const skills = stringList({ maxItems: MAX_EXPERIENCE_SKILLS });

type Exec = Database | Transaction<DB>;

async function select(exec: Exec, userId: string, id?: string, lock = false) {
  let q = exec.selectFrom('experience').select(COLUMNS).where('userId', '=', userId);
  if (id !== undefined) q = q.where('id', '=', id);
  if (lock) q = q.forUpdate();
  const rows = await q.orderBy('sortOrder').orderBy('id').execute();
  return rows.map((r) => ({
    ...r,
    achievements: r.achievements ?? [],
    skills: r.skills ?? [],
  }));
}

export type ExperienceItem = Awaited<ReturnType<typeof select>>[number];

/**
 * The skills of an entry go through the terms registry like every other skill,
 * so "react" typed here and "React" on the skills list are one spelling. The
 * registry's locks come last in the lock order (user row, section rows, terms).
 */
async function columnsOf(trx: Transaction<DB>, input: CreateExperience) {
  const canonical = [...new Set(await canonicalizeTerms(trx, input.skills))];
  return {
    title: input.title,
    organization: input.organization,
    start: input.start,
    end: input.end,
    summary: input.summary,
    achievements: toJsonColumn(achievements, input.achievements),
    skills: toJsonColumn(skills, canonical),
  };
}

export const experienceSection: SectionDefinition<ExperienceItem, CreateExperience> = {
  table: 'experience',
  label: 'experience entry',
  list: (db, userId) => select(db, userId),
  lockOne: async (trx, userId, id) => (await select(trx, userId, id, true))[0],
  getOne: async (trx, userId, id) => (await select(trx, userId, id))[0],
  async insert(trx, userId, id, sortOrder, input) {
    await trx
      .insertInto('experience')
      .values({ id, userId, sortOrder, ...(await columnsOf(trx, input)) })
      .execute();
  },
  async update(trx, userId, id, input) {
    const result = await trx
      .updateTable('experience')
      .set(await columnsOf(trx, input))
      .where('id', '=', id)
      .where('userId', '=', userId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  },
  toInput: ({ id: _id, ...rest }) => rest,
};
