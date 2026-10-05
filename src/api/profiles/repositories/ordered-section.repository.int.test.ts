import { describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { testDatabase } from '../../../testing/database.js';
import { createUser } from '../../../testing/factories.js';
import { educationSection } from './education.repository.js';
import { applyOrder, countOwned, topSortOrder } from './ordered-section.repository.js';

const db = testDatabase();

const input = {
  institution: 'NPUA',
  degree: 'BSc',
  field: 'CS',
  startYear: 2020,
  endYear: null,
  description: null,
  highlights: [],
};

async function addEducation(userId: string, sortOrder: number) {
  const id = newId();
  await inTransaction(db, (trx) => educationSection.insert(trx, userId, id, sortOrder, input));
  return id;
}

const sortOrderOf = async (id: string) =>
  (
    await db
      .selectFrom('education')
      .select('sortOrder')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  ).sortOrder;

describe('ownership is part of every statement, whatever the caller checked first', () => {
  it('update matches no row for another user’s entry, and changes nothing', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const id = await addEducation(alice.id, 0);
    const matched = await inTransaction(db, (trx) =>
      educationSection.update(trx, bob.id, id, { ...input, institution: 'Hacked' }),
    );
    expect(matched).toBe(0);
    const row = await db
      .selectFrom('education')
      .select('institution')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.institution).toBe('NPUA');
  });

  it('update counts matched rows: 1 when the values are unchanged', async () => {
    const alice = await createUser(db);
    const id = await addEducation(alice.id, 0);
    expect(
      await inTransaction(db, (trx) => educationSection.update(trx, alice.id, id, input)),
    ).toBe(1);
  });

  it('lockOne and getOne see only the caller’s entries', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const id = await addEducation(alice.id, 0);
    await inTransaction(db, async (trx) => {
      expect(await educationSection.lockOne(trx, bob.id, id)).toBeUndefined();
      expect(await educationSection.getOne(trx, bob.id, id)).toBeUndefined();
      expect(await educationSection.getOne(trx, alice.id, id)).toMatchObject({ id });
    });
  });

  it('applyOrder writes only the caller’s rows and reports how many matched', async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const mine = await addEducation(bob.id, 7);
    const theirs = await addEducation(alice.id, 9);
    const matched = await inTransaction(db, (trx) =>
      applyOrder(trx, 'education', bob.id, [theirs, mine]),
    );
    expect(matched).toBe(1);
    expect(await sortOrderOf(theirs)).toBe(9);
  });
});

describe('position and count', () => {
  it('a new entry goes one below the smallest sort_order, or at 0 in an empty section', async () => {
    const u = await createUser(db);
    await inTransaction(db, async (trx) => {
      expect(await topSortOrder(trx, 'education', u.id)).toBe(0);
      expect(await countOwned(trx, 'education', u.id)).toBe(0);
    });
    await addEducation(u.id, 3);
    await addEducation(u.id, -2);
    await inTransaction(db, async (trx) => {
      expect(await topSortOrder(trx, 'education', u.id)).toBe(-3);
      expect(await countOwned(trx, 'education', u.id)).toBe(2);
    });
  });

  it('a reorder that fails mid-transaction leaves every sort_order as it was', async () => {
    const u = await createUser(db);
    const a = await addEducation(u.id, 0);
    const b = await addEducation(u.id, 1);
    await expect(
      inTransaction(db, async (trx) => {
        await applyOrder(trx, 'education', u.id, [b, a]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect([await sortOrderOf(a), await sortOrderOf(b)]).toEqual([0, 1]);
  });
});
