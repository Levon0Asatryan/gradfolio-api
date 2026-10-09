import type { Transaction } from 'kysely';
import { newId } from '../../../core/db/ids.js';
import { toJsonColumn } from '../../../core/db/json.js';
import type { DB } from '../../../core/db/types.generated.js';
import { translationParams } from '../../../core/validation/json-shapes.js';
import {
  type ActivityKey,
  type ActivityParams,
  checkActivity,
} from '../utils/activity-registry.js';

/**
 * Writes an activity **inside the transaction of the event it reports**: it
 * commits or rolls back with it (docs/m5-plan.md §8). `userId` is whose feed it
 * lands in. The key and parameters are checked against the registry first, so
 * an event cannot be recorded with prose, private data, or a key the frontend
 * has no text for -- and an invalid one fails the event's transaction too.
 */
export async function recordActivity<K extends ActivityKey>(
  trx: Transaction<DB>,
  userId: string,
  key: K,
  params: ActivityParams<K>,
): Promise<void> {
  const checked = checkActivity(key, params);
  await trx
    .insertInto('activities')
    .values({
      id: newId(),
      userId,
      type: checked.type,
      translationKey: key,
      translationParams: toJsonColumn(translationParams, checked.params),
    })
    .execute();
}
