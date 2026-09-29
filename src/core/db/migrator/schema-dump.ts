import type { RowDataPacket } from 'mysql2/promise';
import { type Connection, REGISTRY_TABLE } from './registry.js';

/**
 * The schema of the connection's database as text that can be diffed:
 * `SHOW CREATE TABLE` for every base table except the migration registry,
 * sorted by name, with the `AUTO_INCREMENT=n` table option removed (it is a
 * counter, not schema).
 *
 * Two databases with the same schema produce the same text; that is how the
 * baseline is proved equal to gradfolio-sql's schema.sql, and up -> down -> up
 * proved to change nothing.
 */
export async function dumpSchema(conn: Connection): Promise<string> {
  const [tables] = await conn.query<RowDataPacket[]>(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> ?
      ORDER BY table_name`,
    [REGISTRY_TABLE],
  );

  const parts: string[] = [];
  for (const { name } of tables as { name: string }[]) {
    const [rows] = await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${name}\``);
    const ddl = String(rows[0]?.['Create Table']);
    parts.push(ddl.replace(/ AUTO_INCREMENT=\d+/, ''));
  }
  return parts.map((p) => `${p};\n`).join('\n');
}
