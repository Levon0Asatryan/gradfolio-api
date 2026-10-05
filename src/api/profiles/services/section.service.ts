import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import { newId } from '../../../core/db/ids.js';
import { inTransaction } from '../../../core/db/transaction.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import {
  applyOrder,
  countOwned,
  deleteOwned,
  lockOwnedIds,
  topSortOrder,
} from '../repositories/ordered-section.repository.js';
import type { SectionDefinition } from '../repositories/section-definition.js';
import { lockUser } from '../../../core/db/user-lock.js';

/** The generic flow of an ordered profile section; the definition owns the columns. */
@Injectable()
export class SectionService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * New entry, placed first. Under the user lock the count and the position
   * cannot be raced: two creates at cap - 1 give one 201 and one 409.
   */
  create<TItem extends { id: string }, TInput>(
    def: SectionDefinition<TItem, TInput>,
    userId: string,
    input: TInput,
  ): Promise<TItem> {
    return inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      if ((await countOwned(trx, def.table, userId)) >= this.cfg.PROFILE_MAX_SECTION_ITEMS) {
        throw new ConflictError(
          'LIMIT_REACHED',
          `at most ${this.cfg.PROFILE_MAX_SECTION_ITEMS} entries are allowed`,
        );
      }
      const id = newId();
      await def.insert(trx, userId, id, await topSortOrder(trx, def.table, userId), input);
      return one(def, await def.getOne(trx, userId, id));
    });
  }

  /**
   * Partial update. The stored entry is read `FOR UPDATE` (scoped to the
   * caller: someone else's id is "not found"), the patch merged over it and
   * the *whole* result validated, so cross-field rules hold and two concurrent
   * patches of one entry cannot each break the rule the other kept.
   */
  update<TItem extends { id: string }, TInput>(
    def: SectionDefinition<TItem, TInput>,
    createSchema: z.ZodType<TInput, unknown>,
    userId: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<TItem> {
    return inTransaction(this.dbs.db, async (trx) => {
      const stored = await def.lockOne(trx, userId, id);
      if (stored === undefined) throw new NotFoundError(def.label);
      const merged = parse(createSchema, { ...def.toInput(stored), ...definedOnly(patch) });
      // The pool counts matched rows, so a patch that changes nothing is 1.
      if ((await def.update(trx, userId, id, merged)) === 0) throw new NotFoundError(def.label);
      return one(def, await def.getOne(trx, userId, id));
    });
  }

  async remove(def: SectionDefinition<{ id: string }, unknown>, userId: string, id: string) {
    if ((await deleteOwned(this.dbs.db, def.table, userId, id)) === 0) {
      throw new NotFoundError(def.label);
    }
  }

  /**
   * Reorders to exactly `ids`. Under the user lock, with the caller's rows
   * locked, so the set cannot change between the check and the write. An id
   * that is not the caller's (foreign, deleted, unknown) is 404, all alike; the
   * right ids but an incomplete list (an entry was added elsewhere) is 409.
   */
  reorder<TItem extends { id: string }>(
    def: SectionDefinition<TItem, unknown>,
    userId: string,
    ids: readonly string[],
  ): Promise<TItem[]> {
    return inTransaction(this.dbs.db, async (trx) => {
      await lockUser(trx, userId);
      const owned = new Set(await lockOwnedIds(trx, def.table, userId));
      if (ids.some((id) => !owned.has(id))) throw new NotFoundError(def.label);
      if (ids.length !== owned.size) {
        throw new ConflictError('ORDER_STALE', 'the list changed; reload it and try again');
      }
      if ((await applyOrder(trx, def.table, userId, ids)) !== ids.length) {
        // Cannot happen under the lock; rolling back beats a half-applied order.
        throw new Error('reorder matched fewer rows than the caller owns');
      }
      return def.list(trx, userId);
    });
  }
}

function parse<T>(schema: z.ZodType<T, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
    );
  }
  return parsed.data;
}

const definedOnly = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function one<T>(def: { label: string }, item: T | undefined): T {
  if (item === undefined) throw new NotFoundError(def.label);
  return item;
}
