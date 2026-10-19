import { type Selectable, sql, type Transaction } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import { newId } from '../../../core/db/ids.js';
import { toJsonColumn } from '../../../core/db/json.js';
import type { GithubProfileSnapshot } from '../../../core/db/column-types.js';
import type { DB, Suggestions } from '../../../core/db/types.generated.js';
import { githubProfileSnapshotSchema } from '../../../core/validation/json-shapes.js';
import { z } from 'zod';

/**
 * `suggestions` (docs/modules/m7/plan.md §6.4). Every statement is scoped to one
 * `user_id`: a suggestion of someone else is "none".
 */

type Executor = Database | Transaction<DB>;
export type SuggestionRow = Selectable<Suggestions>;

const payloadSchema = z.record(z.string(), z.unknown());

export async function listSuggestionRows(
  db: Executor,
  userId: string,
  {
    status,
    after,
    limit,
  }: { status: 'open' | 'all'; after?: { t: number; id: string }; limit: number },
): Promise<SuggestionRow[]> {
  return db
    .selectFrom('suggestions')
    .selectAll()
    .where('userId', '=', userId)
    .$if(status === 'open', (qb) => qb.where('status', '=', 'open'))
    .$if(after !== undefined, (qb) =>
      qb.where(sql<boolean>`(created_at, id) < (${new Date(after!.t)}, ${after!.id})`),
    )
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
}

export async function openCount(db: Executor, userId: string): Promise<number> {
  const row = await db
    .selectFrom('suggestions')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('userId', '=', userId)
    .where('status', '=', 'open')
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** The caller's suggestion, locked until the transaction ends; undefined when it is not theirs. */
export function lockSuggestion(
  trx: Transaction<DB>,
  userId: string,
  id: string,
): Promise<SuggestionRow | undefined> {
  return trx
    .selectFrom('suggestions')
    .selectAll()
    .where('id', '=', id)
    .where('userId', '=', userId)
    .forUpdate()
    .executeTakeFirst();
}

/** Every suggestion of the caller whose key is one of `keys`: key -> status. */
export async function statusesOfKeys(
  trx: Transaction<DB>,
  userId: string,
  keys: readonly string[],
): Promise<Map<string, SuggestionRow['status']>> {
  if (keys.length === 0) return new Map();
  const rows = await trx
    .selectFrom('suggestions')
    .select(['dedupeKey', 'status'])
    .where('userId', '=', userId)
    .where('dedupeKey', 'in', [...keys])
    .execute();
  return new Map(rows.map((r) => [r.dedupeKey, r.status]));
}

/** The caller's open suggestions of these sources. */
export function openOfSources(
  trx: Transaction<DB>,
  userId: string,
  sources: readonly SuggestionRow['source'][],
): Promise<SuggestionRow[]> {
  if (sources.length === 0) return Promise.resolve([]);
  return trx
    .selectFrom('suggestions')
    .selectAll()
    .where('userId', '=', userId)
    .where('status', '=', 'open')
    .where('source', 'in', [...sources])
    .execute();
}

export async function insertOpen(
  trx: Transaction<DB>,
  userId: string,
  row: {
    kind: string;
    source: SuggestionRow['source'];
    dedupeKey: string;
    payload: Record<string, unknown>;
    targetId?: string | null;
  },
): Promise<void> {
  await trx
    .insertInto('suggestions')
    .values({
      id: newId(),
      userId,
      kind: row.kind,
      source: row.source,
      dedupeKey: row.dedupeKey,
      targetId: row.targetId ?? null,
      payload: toJsonColumn(payloadSchema, row.payload),
      status: 'open',
    })
    .execute();
}

/** Marks these (the caller's, open) suggestions superseded. */
export async function supersede(
  trx: Transaction<DB>,
  userId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await trx
    .updateTable('suggestions')
    .set({ status: 'superseded', resolvedAt: sql<Date>`UTC_TIMESTAMP()` })
    .where('userId', '=', userId)
    .where('status', '=', 'open')
    .where('id', 'in', [...ids])
    .execute();
}

/** Open -> accepted or dismissed, only if still open; rows matched. */
export async function resolve(
  trx: Transaction<DB>,
  userId: string,
  id: string,
  status: 'accepted' | 'dismissed',
): Promise<number> {
  const result = await trx
    .updateTable('suggestions')
    .set({ status, resolvedAt: sql<Date>`UTC_TIMESTAMP()` })
    .where('id', '=', id)
    .where('userId', '=', userId)
    .where('status', '=', 'open')
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Replaces the payload of the caller's suggestion (an accept records what it wrote). */
export async function setPayload(
  trx: Transaction<DB>,
  userId: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await trx
    .updateTable('suggestions')
    .set({ payload: toJsonColumn(payloadSchema, payload) })
    .where('id', '=', id)
    .where('userId', '=', userId)
    .execute();
}

/** What a refresh needs of the caller's GitHub row. */
export interface GithubPollState {
  status: 'connected' | 'not_connected' | 'linking';
  generation: number;
  polledAt: Date | null;
  etag: string | null;
  snapshot: GithubProfileSnapshot | null;
}

export async function readPollState(
  db: Executor,
  userId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<GithubPollState | undefined> {
  const query = db
    .selectFrom('integrations')
    .select(['status', 'generation', 'suggestionsPolledAt', 'profileEtag', 'profileSnapshot'])
    .where('userId', '=', userId)
    .where('integrationType', '=', 'github');
  // Locked, the read is the latest commit, not the transaction's snapshot.
  const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
  if (row === undefined) return undefined;
  return {
    status: row.status,
    generation: row.generation,
    polledAt: row.suggestionsPolledAt,
    etag: row.profileEtag,
    snapshot: row.profileSnapshot,
  };
}

/**
 * Claims the right to read GitHub: stamps `suggestions_polled_at` only when it
 * is older than the floor, in one statement, so two refreshes at once make one
 * GitHub call. `false`: someone read it less than `floorS` seconds ago.
 */
export async function claimRefresh(db: Executor, userId: string, floorS: number): Promise<boolean> {
  const result = await db
    .updateTable('integrations')
    .set({ suggestionsPolledAt: sql<Date>`UTC_TIMESTAMP()` })
    .where('userId', '=', userId)
    .where('integrationType', '=', 'github')
    .where('status', '=', 'connected')
    .where((eb) =>
      eb.or([
        eb('suggestionsPolledAt', 'is', null),
        eb('suggestionsPolledAt', '<=', sql<Date>`UTC_TIMESTAMP() - INTERVAL ${floorS} SECOND`),
      ]),
    )
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

/** A refresh that failed gives its claim back, so the student is not made to wait for nothing. */
export async function restorePolled(
  db: Executor,
  userId: string,
  previous: Date | null,
): Promise<void> {
  await db
    .updateTable('integrations')
    .set({ suggestionsPolledAt: previous })
    .where('userId', '=', userId)
    .where('integrationType', '=', 'github')
    .execute();
}

export async function writeProfileSnapshot(
  trx: Transaction<DB>,
  userId: string,
  etag: string | null,
  snapshot: GithubProfileSnapshot,
): Promise<void> {
  await trx
    .updateTable('integrations')
    .set({
      profileEtag: etag,
      profileSnapshot: toJsonColumn(githubProfileSnapshotSchema, snapshot),
    })
    .where('userId', '=', userId)
    .where('integrationType', '=', 'github')
    .execute();
}

/** The last confirmed LinkedIn export import. */
export async function linkedinLastSynced(db: Executor, userId: string): Promise<Date | null> {
  const row = await db
    .selectFrom('integrations')
    .select('lastSyncedAt')
    .where('userId', '=', userId)
    .where('integrationType', '=', 'linkedin')
    .executeTakeFirst();
  return row?.lastSyncedAt ?? null;
}

/** The oldest `extra` open suggestions of the caller: what to supersede over the cap. */
export async function oldestOpen(trx: Transaction<DB>, userId: string, extra: number) {
  return trx
    .selectFrom('suggestions')
    .select('id')
    .where('userId', '=', userId)
    .where('status', '=', 'open')
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .limit(extra)
    .execute();
}

/** The caller's profile fields as they are now (read under the lock, not at request start). */
export async function currentProfile(trx: Transaction<DB>, userId: string) {
  const u = await trx
    .selectFrom('users')
    .select(['name', 'headline', 'bio', 'location', 'avatarUrl', 'github', 'website'])
    .where('id', '=', userId)
    .executeTakeFirst();
  return u;
}

/** The caller's listed skills, in their order. */
export async function skillNamesOf(trx: Transaction<DB>, userId: string): Promise<string[]> {
  const rows = await trx
    .selectFrom('userSkills')
    .select('skillName')
    .where('userId', '=', userId)
    .orderBy('sortOrder')
    .execute();
  return rows.map((r) => r.skillName);
}

/** The technologies of each of the caller's own projects (drafts too), one row per technology. */
export function projectTechnologies(
  trx: Transaction<DB>,
  userId: string,
): Promise<{ projectId: string; githubRepoId: number | null; name: string }[]> {
  return trx
    .selectFrom('projects')
    .innerJoin('projectTechnologies', 'projectTechnologies.projectId', 'projects.id')
    .select(['projects.id as projectId', 'projects.githubRepoId', 'projectTechnologies.name'])
    .where('projects.userId', '=', userId)
    .execute();
}
