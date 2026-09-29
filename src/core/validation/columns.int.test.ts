import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { testDatabase } from '../../testing/database.js';
import { COLUMN_LIMITS } from './columns.js';
import { type ColumnLimit, chars } from './text.js';

/**
 * COLUMN_LIMITS against the migrated schema: every string column, and each
 * one's real limit. A migration that adds or resizes one fails here until the
 * validators follow.
 */
describe('COLUMN_LIMITS', () => {
  it('matches every string column of the migrated schema', async () => {
    const rows = await sql<{
      tableName: string;
      columnName: string;
      dataType: string;
      chars: number;
      bytes: number;
    }>`
      SELECT table_name AS tableName, column_name AS columnName, data_type AS dataType,
             character_maximum_length AS chars, character_octet_length AS bytes
        FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'
         AND data_type IN ('char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext')
       ORDER BY table_name, column_name`.execute(testDatabase());

    const actual: Record<string, ColumnLimit> = {};
    for (const r of rows.rows) {
      actual[`${r.tableName}.${r.columnName}`] =
        r.dataType === 'char' || r.dataType === 'varchar'
          ? chars(Number(r.chars))
          : { kind: 'bytes', max: Number(r.chars) };
    }
    expect(Object.keys(actual).length).toBeGreaterThan(50);
    expect(actual).toEqual(COLUMN_LIMITS);
  });
});
