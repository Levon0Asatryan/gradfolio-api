import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { waitForLockWaiters } from '../../testing/barrier.js';
import { testDatabase } from '../../testing/database.js';
import { createProfile, createProject, createUser } from '../../testing/factories.js';
import { normalizeTerm } from '../validation/terms.js';
import { canonicalizeTerms, setProjectTerms } from './terms.js';
import { inTransaction } from './transaction.js';

describe('tags and technologies against MySQL 8.4', () => {
  const db = testDatabase();

  it('store the canonical spelling and match case-insensitively', async () => {
    const owner = await createUser(db);
    const first = await createProject(db, owner, { technologies: ['React', 'Go'] });
    const second = await createProject(db, owner, { technologies: [' react ', 'GO'] });
    expect(first.technologies).toEqual(['React', 'Go']);
    expect(second.technologies).toEqual(['React', 'Go']);

    const byTag = await db
      .selectFrom('projectTechnologies')
      .select('projectId')
      .where('name', '=', 'REACT')
      .orderBy('projectId')
      .execute();
    expect(byTag.map((r) => r.projectId)).toEqual([first.project.id, second.project.id].sort());
    const cloud = await db
      .selectFrom('projectTechnologies')
      .select(['name', (eb) => eb.fn.countAll<number>().as('n')])
      .groupBy('name')
      .orderBy('name')
      .execute();
    expect(cloud).toEqual([
      { name: 'Go', n: 2 },
      { name: 'React', n: 2 },
    ]);
  });

  it('share one namespace across skills, technologies and tags', async () => {
    const { user } = await createProfile(db, { skills: ['PostgreSQL'] });
    const { technologies, tags } = await createProject(db, user, {
      technologies: ['postgresql'],
      tags: ['POSTGRESQL'],
    });
    expect(technologies).toEqual(['PostgreSQL']);
    expect(tags).toEqual(['PostgreSQL']);
  });

  it('collapse duplicates within one list to the first, as the collation decides', async () => {
    const owner = await createUser(db);
    const { technologies } = await createProject(db, owner, {
      technologies: ['Vue', 'vue', 'VUE ', 'Nuxt'],
    });
    expect(technologies).toEqual(['Vue', 'Nuxt']);
  });

  it('replace a project’s list, keeping the order given', async () => {
    const owner = await createUser(db);
    const { project } = await createProject(db, owner, {
      technologies: ['A1', 'B1'],
      attachments: [{ type: 'image', url: 'https://images.example.com/a.png', title: 'A' }],
    });
    await inTransaction(db, (trx) =>
      setProjectTerms(trx, project.id, 'technologies', ['C1', 'A1']),
    );
    const rows = await db
      .selectFrom('projectTechnologies')
      .select('name')
      .where('projectId', '=', project.id)
      .orderBy('sortOrder')
      .execute();
    expect(rows.map((r) => r.name)).toEqual(['C1', 'A1']);
    const attachments = await db
      .selectFrom('projectAttachments')
      .select(['type', 'url'])
      .where('projectId', '=', project.id)
      .execute();
    expect(attachments).toEqual([{ type: 'image', url: 'https://images.example.com/a.png' }]);
  });

  it('give two concurrent first writers one spelling (barrier)', async () => {
    // A registers "Svelte" and holds its transaction open; B, which already has
    // a REPEATABLE READ snapshot, registers "svelte" and blocks on the key.
    let releaseA!: () => void;
    const aMayCommit = new Promise<void>((resolve) => (releaseA = resolve));
    const a = inTransaction(db, async (trx) => {
      const names = await canonicalizeTerms(trx, ['Svelte']);
      await aMayCommit;
      return names;
    });
    // Let A take the key before B starts.
    await waitUntilTermRegistered('Svelte');
    const b = inTransaction(db, async (trx) => {
      await sql`SELECT COUNT(*) FROM users`.execute(trx); // B's snapshot predates A's commit
      return canonicalizeTerms(trx, ['svelte']);
    });
    await waitForLockWaiters(1);
    releaseA();
    expect(await a).toEqual(['Svelte']);
    expect(await b).toEqual(['Svelte']);
    const stored = await sql<{
      name: string;
    }>`SELECT CAST(name AS BINARY) AS name FROM terms WHERE name = 'svelte'`.execute(db);
    expect(stored.rows.map((r) => String(r.name))).toEqual(['Svelte']);
  });

  /** Polls until A's uncommitted insert holds the key (READ UNCOMMITTED peek). */
  async function waitUntilTermRegistered(name: string) {
    for (let i = 0; i < 500; i++) {
      const rows = await db.connection().execute(async (conn) => {
        await sql`SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED`.execute(conn);
        const r =
          await sql`SELECT 1 FROM terms WHERE CAST(name AS BINARY) = CAST(${name} AS BINARY)`.execute(
            conn,
          );
        await sql`SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(conn);
        return r.rows;
      });
      if (rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`${name} was never registered`);
  }

  it('normalize the same in SQL (migration 0003) as in JS', async () => {
    const corpus = [
      'React  Native',
      ' React ',
      'React\tNative',
      'React Native',
      'React Native',
      '　Go',
      'Go\n',
      'a \t  b',
      'Ծրագրավորում  Python',
    ];
    for (const value of corpus) {
      const r = await sql<{
        n: string;
      }>`SELECT TRIM(REGEXP_REPLACE(${value}, '[[:space:]]+', ' ')) AS n`.execute(db);
      expect([value, r.rows[0]?.n]).toEqual([value, normalizeTerm(value)]);
    }
  });
});
