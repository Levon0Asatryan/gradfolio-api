import { type RawBuilder, sql } from 'kysely';
import type { Database } from '../../../core/db/database.js';
import { discoverableOwner, discoverableProject, discoverableUser } from '../utils/discoverable.js';
import type { DiscoveryCursor } from '../utils/discovery-cursor.js';
import { escapeLike, type ParsedQuery, type Token } from '../utils/search-query.js';

/**
 * The statements behind search (docs/m6-plan.md §3.3, §4). Every one starts from
 * `discoverableUser` / `discoverableProject` + `discoverableOwner`, then adds the
 * query's predicates, so no search path can return a row discovery may not.
 *
 * Raw fragments name tables and columns as MySQL does (snake_case, unaliased
 * `users` / `projects`): Kysely's camel-case plugin does not rewrite raw text.
 */

/** Words that start at the beginning of the text, or after a space: `ML` in `an ML engineer`. */
const startOf = (t: Token) => `${escapeLike(t.text)}%`;
const wordIn = (t: Token) => `% ${escapeLike(t.text)}%`;

const all = (parts: RawBuilder<boolean>[]) =>
  parts.length === 0 ? sql<boolean>`TRUE` : sql<boolean>`(${sql.join(parts, sql` AND `)})`;

// ------------------------------------------------------------------ people

const skillIs = (t: Token) =>
  sql<boolean>`EXISTS (SELECT 1 FROM user_skills s WHERE s.user_id = users.id AND s.skill_name = ${t.text})`;
const skillStarts = (t: Token) =>
  sql<boolean>`EXISTS (SELECT 1 FROM user_skills s WHERE s.user_id = users.id AND s.skill_name LIKE ${startOf(t)})`;

/** One token against a person: name or headline (FULLTEXT or word start), or a skill. */
function personToken(t: Token): RawBuilder<boolean> {
  if (t.kind === 'single') return skillIs(t);
  if (t.kind === 'short') {
    return sql<boolean>`(users.name LIKE ${startOf(t)} OR users.name LIKE ${wordIn(t)}
      OR users.headline LIKE ${startOf(t)} OR users.headline LIKE ${wordIn(t)} OR ${skillIs(t)})`;
  }
  return sql<boolean>`(MATCH(users.name, users.headline) AGAINST (${`+${t.text}*`} IN BOOLEAN MODE)
    OR ${skillIs(t)} OR ${skillStarts(t)})`;
}

/** 3: the name is the query; 2: every word starts a word of the name; 1: anything else that matched. */
function personRank(q: ParsedQuery): RawBuilder<number> {
  const startsName = q.tokens.some((t) => t.kind === 'single')
    ? sql<boolean>`FALSE`
    : all(
        q.tokens.map(
          (t) => sql<boolean>`(users.name LIKE ${startOf(t)} OR users.name LIKE ${wordIn(t)})`,
        ),
      );
  return sql<number>`(CASE WHEN users.name = ${q.text} THEN 3 WHEN ${startsName} THEN 2 ELSE 1 END)`;
}

/** The comparison that continues after `cursor` in `(relevance DESC, created_at DESC, id DESC)`. */
const after = (c: DiscoveryCursor | undefined) =>
  c?.r === undefined
    ? undefined
    : sql<boolean>`(c.relevance < ${c.r} OR (c.relevance = ${c.r}
        AND (c.created_at, c.id) < (${new Date(c.t)}, ${c.id})))`;

/** At most `limit + 1` people matching `q`, best first; the extra row says another page exists. */
export function findPeople(
  db: Database,
  q: ParsedQuery,
  cursor: DiscoveryCursor | undefined,
  limit: number,
) {
  const candidates = db
    .selectFrom('users')
    .select([
      'users.id',
      'users.name',
      'users.headline',
      'users.avatarUrl',
      'users.verified',
      'users.location',
      'users.createdAt',
    ])
    .select(personRank(q).as('relevance'))
    .where((eb) => discoverableUser(eb))
    .where(all(q.tokens.map(personToken)));
  const cond = after(cursor);
  return db
    .selectFrom(candidates.as('c'))
    .selectAll('c')
    .$if(cond !== undefined, (qb) => qb.where(cond!))
    .orderBy('c.relevance', 'desc')
    .orderBy('c.createdAt', 'desc')
    .orderBy('c.id', 'desc')
    .limit(limit + 1)
    .execute();
}

/** Up to 5 skills each, in the owner's order, for a page of people. One statement. */
export async function skillsOf(db: Database, userIds: readonly string[]) {
  const byUser = new Map<string, string[]>();
  if (userIds.length === 0) return byUser;
  const { rows } = await sql<{ userId: string; skillName: string }>`
    SELECT x.user_id, x.skill_name FROM (
      SELECT user_id, skill_name,
             ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY sort_order, skill_name) AS n
        FROM user_skills WHERE user_id IN (${sql.join(userIds)})
    ) x WHERE x.n <= 5 ORDER BY x.user_id, x.n`.execute(db);
  for (const { userId, skillName } of rows) {
    const list = byUser.get(userId) ?? [];
    list.push(skillName);
    byUser.set(userId, list);
  }
  return byUser;
}

/**
 * Discoverable projects per person: their own published ones, and those they
 * are an accepted member of. A pending or rejected row counts for nothing, and
 * neither does a private or draft project or one whose owner's profile is
 * private (N2, D5). One statement for the page.
 */
export async function projectCountsOf(db: Database, userIds: readonly string[]) {
  const counts = new Map<string, number>();
  if (userIds.length === 0) return counts;
  const ids = userIds as string[];
  const own = db
    .selectFrom('projects')
    .innerJoin('users as owner', 'owner.id', 'projects.userId')
    .select(['projects.userId as userId', 'projects.id as projectId'])
    .where('projects.userId', 'in', ids)
    .where((eb) => discoverableProject(eb))
    .where('owner.isPublic', '=', true);
  const member = db
    .selectFrom('projectTeamMembers as m')
    .innerJoin('projects', 'projects.id', 'm.projectId')
    .innerJoin('users as owner', 'owner.id', 'projects.userId')
    .select([(eb) => eb.ref('m.userId').$castTo<string>().as('userId'), 'm.projectId as projectId'])
    .where('m.userId', 'in', ids)
    .where('m.status', '=', 'accepted')
    .where((eb) => discoverableProject(eb))
    .where('owner.isPublic', '=', true);
  const rows = await db
    .selectFrom(own.union(member).as('x'))
    .select(['x.userId', (eb) => eb.fn.countAll<number>().as('n')])
    .groupBy('x.userId')
    .execute();
  for (const r of rows) {
    if (r.userId !== null) counts.set(r.userId, Number(r.n));
  }
  return counts;
}

// ---------------------------------------------------------------- projects

const termIs = (t: Token) =>
  sql<boolean>`(EXISTS (SELECT 1 FROM project_technologies x WHERE x.project_id = projects.id AND x.name = ${t.text})
    OR EXISTS (SELECT 1 FROM project_tags g WHERE g.project_id = projects.id AND g.name = ${t.text}))`;

/** One token against a project: text (FULLTEXT or word start) or an exact technology/tag. */
function projectToken(t: Token): RawBuilder<boolean> {
  if (t.kind === 'single') return termIs(t);
  if (t.kind === 'short') {
    return sql<boolean>`(projects.title LIKE ${startOf(t)} OR projects.title LIKE ${wordIn(t)}
      OR projects.summary LIKE ${startOf(t)} OR projects.summary LIKE ${wordIn(t)} OR ${termIs(t)})`;
  }
  return sql<boolean>`(MATCH(projects.title, projects.summary, projects.ai_summary)
    AGAINST (${`+${t.text}*`} IN BOOLEAN MODE) OR ${termIs(t)})`;
}

/** 3: the title is the query; 2: every word is in the title or is a technology/tag; 1: the summary. */
function projectRank(q: ParsedQuery): RawBuilder<number> {
  const inTitleOrTerm = all(
    q.tokens.map((t) =>
      t.kind === 'single'
        ? termIs(t)
        : sql<boolean>`(projects.title LIKE ${startOf(t)} OR projects.title LIKE ${wordIn(t)} OR ${termIs(t)})`,
    ),
  );
  return sql<number>`(CASE WHEN projects.title = ${q.text} THEN 3 WHEN ${inTitleOrTerm} THEN 2 ELSE 1 END)`;
}

/** The card's columns, listed one by one and never `selectAll`: a new column must be opted in here. */
const CARD_COLUMNS = [
  'projects.id',
  'projects.title',
  'projects.summary',
  'projects.category',
  'projects.status',
  'projects.heroImageUrl',
  'projects.createdAt',
  'projects.updatedAt',
] as const;

/** At most `limit + 1` discoverable projects matching `q`, best first. */
export function findProjects(
  db: Database,
  q: ParsedQuery,
  cursor: DiscoveryCursor | undefined,
  limit: number,
) {
  const candidates = db
    .selectFrom('projects')
    .innerJoin('users as owner', 'owner.id', 'projects.userId')
    .select(CARD_COLUMNS)
    .select(['owner.id as ownerId', 'owner.name as ownerName', 'owner.avatarUrl as ownerAvatarUrl'])
    .select(projectRank(q).as('relevance'))
    .where((eb) => discoverableProject(eb))
    .where((eb) => discoverableOwner(eb as never))
    .where(all(q.tokens.map(projectToken)));
  const cond = after(cursor);
  return db
    .selectFrom(candidates.as('c'))
    .selectAll('c')
    .$if(cond !== undefined, (qb) => qb.where(cond!))
    .orderBy('c.relevance', 'desc')
    .orderBy('c.createdAt', 'desc')
    .orderBy('c.id', 'desc')
    .limit(limit + 1)
    .execute();
}
