import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createUser } from '../../testing/factories.js';
import { testDatabase } from '../../testing/database.js';
import { newId } from './ids.js';
import { toJsonColumn } from './json.js';
import { translationParams } from '../validation/json-shapes.js';

describe('the query layer against MySQL 8.4', () => {
  const db = testDatabase();

  it('answers at all: it runs on the callback pool, not the promise one that hangs', async () => {
    const result = await sql<{ one: number }>`SELECT 1 AS one`.execute(db);
    expect(result.rows).toEqual([{ one: 1 }]);
  });

  it('reads TINYINT(1) as boolean and maps snake_case columns to camelCase', async () => {
    const user = await createUser(db, { isPublic: false, verified: true });
    expect(user.isPublic).toBe(false);
    expect(user.verified).toBe(true);
    expect(user).toHaveProperty('auth0Id');
    expect(user).not.toHaveProperty('auth0_id');
  });

  it('reads DATE as YYYY-MM-DD and DATETIME as a Date', async () => {
    const user = await createUser(db, { birthday: '2002-03-15' });
    expect(user.birthday).toBe('2002-03-15');
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('keeps the keys inside JSON values as stored, snake_case included', async () => {
    const user = await createUser(db);
    const id = newId();
    await db
      .insertInto('activities')
      .values({
        id,
        userId: user.id,
        type: 'project',
        translationKey: 'projectUpdated',
        translationParams: toJsonColumn(translationParams, { project_name: 'Gradfolio', n: 2 }),
      })
      .execute();
    const row = await db
      .selectFrom('activities')
      .select('translationParams')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.translationParams).toEqual({ project_name: 'Gradfolio', n: 2 });
  });

  it('stores the id the application generated', async () => {
    const id = newId();
    const user = await createUser(db, { id });
    expect(user.id).toBe(id);
  });
});

describe('row types', () => {
  it('require an application-generated id, and validated JSON', () => {
    const db = testDatabase();
    // Type-level guards; the calls are never executed.
    const typeChecks = () => [
      // @ts-expect-error -- id is required: DEFAULT (UUID()) cannot be read back
      db.insertInto('users').values({ auth0Id: 'x', name: 'x' }),
      db.insertInto('education').values({
        id: newId(),
        userId: 'u',
        institution: 'i',
        degree: 'd',
        field: 'f',
        startYear: 2020,
        // @ts-expect-error -- JSON columns take toJsonColumn's validated text only
        highlights: JSON.stringify(['unvalidated']),
      }),
    ];
    expect(typeof typeChecks).toBe('function');
  });
});
