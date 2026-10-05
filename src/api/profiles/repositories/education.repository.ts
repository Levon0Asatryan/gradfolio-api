import type { Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import { toJsonColumn } from '../../../core/db/json.js';
import type { DB } from '../../../core/db/types.generated.js';
import { stringList } from '../../../core/validation/json-shapes.js';
import { type CreateEducation, MAX_HIGHLIGHTS } from '../dto/section.dto.js';
import type { SectionDefinition } from './section-definition.js';

const COLUMNS = [
  'id',
  'institution',
  'degree',
  'field',
  'startYear',
  'endYear',
  'description',
  'highlights',
] as const;

const highlights = stringList({ maxItems: MAX_HIGHLIGHTS });

type Exec = Database | Transaction<DB>;

async function select(exec: Exec, userId: string, id?: string, lock = false) {
  let q = exec.selectFrom('education').select(COLUMNS).where('userId', '=', userId);
  if (id !== undefined) q = q.where('id', '=', id);
  if (lock) q = q.forUpdate();
  const rows = await q.orderBy('sortOrder').orderBy('id').execute();
  return rows.map((r) => ({ ...r, highlights: r.highlights ?? [] }));
}

export type EducationItem = Awaited<ReturnType<typeof select>>[number];

export const educationSection: SectionDefinition<EducationItem, CreateEducation> = {
  table: 'education',
  label: 'education entry',
  list: (db, userId) => select(db, userId),
  lockOne: async (trx, userId, id) => (await select(trx, userId, id, true))[0],
  getOne: async (trx, userId, id) => (await select(trx, userId, id))[0],
  async insert(trx, userId, id, sortOrder, input) {
    await trx
      .insertInto('education')
      .values({
        id,
        userId,
        sortOrder,
        institution: input.institution,
        degree: input.degree,
        field: input.field,
        startYear: input.startYear,
        endYear: input.endYear,
        description: input.description,
        highlights: toJsonColumn(highlights, input.highlights),
      })
      .execute();
  },
  async update(trx, userId, id, input) {
    const result = await trx
      .updateTable('education')
      .set({
        institution: input.institution,
        degree: input.degree,
        field: input.field,
        startYear: input.startYear,
        endYear: input.endYear,
        description: input.description,
        highlights: toJsonColumn(highlights, input.highlights),
      })
      .where('id', '=', id)
      .where('userId', '=', userId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  },
  toInput: ({ id: _id, ...rest }) => rest,
};
