import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { testDatabase } from '../../../testing/database.js';
import { createProject, createUser } from '../../../testing/factories.js';
import { FT_STOPWORDS } from '../utils/search-query.js';

/**
 * The server facts the search design rests on (docs/m6-plan.md §1.4), asserted
 * so that a MySQL upgrade or a changed Cloud SQL flag fails here instead of
 * returning silent zeros in production.
 */
describe('the FULLTEXT behaviour the search relies on (MySQL 8.4)', () => {
  const db = testDatabase();

  it('has the stopword list the tokenizer carries', async () => {
    const { rows } = await sql<{ value: string }>`
      SELECT value FROM information_schema.INNODB_FT_DEFAULT_STOPWORD`.execute(db);
    expect(new Set(rows.map((r) => r.value))).toEqual(FT_STOPWORDS);
  });

  it('indexes only words of three characters or more (innodb_ft_min_token_size = 3)', async () => {
    const { rows } = await sql<{ n: string }>`SELECT @@innodb_ft_min_token_size AS n`.execute(db);
    expect(Number(rows[0]!.n)).toBe(3);
  });

  it('finds a three-letter word, and no two-letter one, even with a wildcard', async () => {
    const user = await createUser(db, { name: 'Token Probe' });
    await createProject(db, user, {
      title: 'Probe',
      summary: 'IoT sensors with ML and AI, written in Go and C#, the chat app',
    });
    const count = async (against: string) => {
      // Rows, not COUNT(*): with deleted documents still in the index, COUNT(*) over a
      // MATCH answered 737 for one existing row (run, 8.4.11). Search never counts that way.
      const { rows } = await sql<{ id: string }>`
        SELECT id FROM projects
         WHERE MATCH(title, summary, ai_summary) AGAINST (${against} IN BOOLEAN MODE)`.execute(db);
      return rows.length;
    };
    expect(await count('+IoT*')).toBe(1);
    for (const short of ['+ML', '+ML*', '+AI*', '+Go', '+C#']) expect(await count(short)).toBe(0);
    // a required stopword empties the query, which is why the tokenizer drops them
    expect(await count('+chat')).toBe(1);
    expect(await count('+the +chat')).toBe(0);
  });

  it('answers an operator character with a syntax error, which is why only letters and digits reach AGAINST', async () => {
    for (const bad of ['+(', '@3', '*', '++a']) {
      await expect(
        sql`SELECT COUNT(*) FROM projects WHERE MATCH(title, summary, ai_summary) AGAINST (${bad} IN BOOLEAN MODE)`.execute(
          db,
        ),
      ).rejects.toThrow();
    }
  });

  it('compares text without regard to case, accents or ё/е, and LIKE agrees', async () => {
    const { rows } = await sql<{ a: number; b: number; c: number; d: number }>`
      SELECT 'ML' = 'ml' AS a, 'Алёна' = 'алена' AS b, 'ԱՐՄԵՆ' = 'արմեն' AS c,
             'Алёна' LIKE 'алена%' AS d`.execute(db);
    expect(rows[0]).toEqual({ a: 1, b: 1, c: 1, d: 1 });
  });
});
