import { randomUUID } from 'node:crypto';

/**
 * A new primary key. The application supplies every id: an INSERT relying on
 * the columns' `DEFAULT (UUID())` leaves `LAST_INSERT_ID()` at 0, so the new
 * row's id could not be read back. The row types make `id` required on insert.
 */
export function newId(): string {
  return randomUUID();
}
