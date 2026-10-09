/**
 * MySQL error numbers the application acts on. Each is produced by a real
 * statement in mysql-errors.int.test.ts, so this table is checked against the
 * driver's actual errors, not hand-built ones.
 */
export const MysqlErrno = {
  /** Unique key violated. */
  DUPLICATE_KEY: 1062,
  /** A foreign key points at a row that is not (or no longer) there. */
  FOREIGN_KEY_MISSING: 1452,
  /** Chosen as the deadlock victim; InnoDB rolled the whole transaction back. */
  DEADLOCK: 1213,
  /** A CHECK constraint rejected the row. */
  CHECK_VIOLATED: 3819,
  /** A value longer than its column (strict mode). */
  DATA_TOO_LONG: 1406,
} as const;

/** The MySQL error number of `err`, or undefined when it is not a MySQL error. */
export function mysqlErrno(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const errno = (err as { errno?: unknown }).errno;
  const sqlState = (err as { sqlState?: unknown }).sqlState;
  // Node's own system errors carry a (negative) errno too; a server error
  // always carries its SQLSTATE.
  return typeof errno === 'number' && typeof sqlState === 'string' ? errno : undefined;
}

export function isMysqlError(err: unknown, errno: number): boolean {
  return mysqlErrno(err) === errno;
}
