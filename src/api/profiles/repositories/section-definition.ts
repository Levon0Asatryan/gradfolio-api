import type { Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import type { DB } from '../../../core/db/types.generated.js';
import type { SectionTable } from './ordered-section.repository.js';

/**
 * Everything the generic section service needs to know about one ordered
 * section. The service owns the flow (lock, cap, position, merge, validate);
 * a definition owns the columns.
 */
export interface SectionDefinition<TItem extends { id: string }, TInput> {
  table: SectionTable;
  /** Names the entry in "not found" errors. */
  label: string;
  /** The caller's entries in display order. */
  list(db: Database | Transaction<DB>, userId: string): Promise<TItem[]>;
  /** One of the caller's entries, locked `FOR UPDATE`; undefined if not theirs. */
  lockOne(trx: Transaction<DB>, userId: string, id: string): Promise<TItem | undefined>;
  /** One of the caller's entries, read plainly. */
  getOne(trx: Transaction<DB>, userId: string, id: string): Promise<TItem | undefined>;
  insert(
    trx: Transaction<DB>,
    userId: string,
    id: string,
    sortOrder: number,
    input: TInput,
  ): Promise<void>;
  /** Returns the rows matched (0: not the caller's). */
  update(trx: Transaction<DB>, userId: string, id: string, input: TInput): Promise<number>;
  /** An entry as the candidate a create schema validates (the id removed). */
  toInput(item: TItem): Record<string, unknown>;
}
