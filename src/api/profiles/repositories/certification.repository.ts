import type { Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { DB } from '../../../core/db/types.generated.js';
import type { CreateCertification } from '../dto/section.dto.js';
import type { SectionDefinition } from './section-definition.js';

const COLUMNS = ['id', 'name', 'issuer', 'date', 'credentialUrl'] as const;

type Exec = Database | Transaction<DB>;

function select(exec: Exec, userId: string, id?: string, lock = false) {
  let q = exec.selectFrom('certifications').select(COLUMNS).where('userId', '=', userId);
  if (id !== undefined) q = q.where('id', '=', id);
  if (lock) q = q.forUpdate();
  return q.orderBy('sortOrder').orderBy('id').execute();
}

export type CertificationItem = Awaited<ReturnType<typeof select>>[number];

export const certificationSection: SectionDefinition<CertificationItem, CreateCertification> = {
  table: 'certifications',
  label: 'certification',
  list: (db, userId) => select(db, userId),
  lockOne: async (trx, userId, id) => (await select(trx, userId, id, true))[0],
  getOne: async (trx, userId, id) => (await select(trx, userId, id))[0],
  async insert(trx, userId, id, sortOrder, input) {
    await trx
      .insertInto('certifications')
      .values({
        id,
        userId,
        sortOrder,
        name: input.name,
        issuer: input.issuer,
        date: input.date,
        credentialUrl: input.credentialUrl,
      })
      .execute();
  },
  async update(trx, userId, id, input) {
    const result = await trx
      .updateTable('certifications')
      .set({
        name: input.name,
        issuer: input.issuer,
        date: input.date,
        credentialUrl: input.credentialUrl,
      })
      .where('id', '=', id)
      .where('userId', '=', userId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  },
  toInput: ({ id: _id, ...rest }) => rest,
};
