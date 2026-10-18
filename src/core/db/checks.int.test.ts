import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { testDatabase } from '../../testing/database.js';
import { createUser } from '../../testing/factories.js';
import { newId } from './ids.js';
import { MysqlErrno, mysqlErrno } from './mysql-errors.js';

/**
 * Every CHECK from 0002_value_checks, each rejecting a real bad value through
 * the real driver (raw SQL: the query layer's types would not let these
 * values through at all).
 */
describe('CHECK constraints', () => {
  const db = testDatabase();
  const errnoOf = (p: Promise<unknown>) => p.then(() => undefined, mysqlErrno);

  const cases: [string, (userId: string) => ReturnType<typeof sql>][] = [
    [
      'education.highlights = {"a":1}',
      (u) =>
        sql`INSERT INTO education (id, user_id, institution, degree, field, start_year, highlights) VALUES (${newId()}, ${u}, 'i', 'd', 'f', 2020, '{"a":1}')`,
    ],
    [
      'education.highlights = [1]',
      (u) =>
        sql`INSERT INTO education (id, user_id, institution, degree, field, start_year, highlights) VALUES (${newId()}, ${u}, 'i', 'd', 'f', 2020, '[1]')`,
    ],
    [
      'education.highlights = null (JSON)',
      (u) =>
        sql`INSERT INTO education (id, user_id, institution, degree, field, start_year, highlights) VALUES (${newId()}, ${u}, 'i', 'd', 'f', 2020, 'null')`,
    ],
    [
      'experience.achievements = {"a":1}',
      (u) =>
        sql`INSERT INTO experience (id, user_id, title, organization, start, summary, achievements) VALUES (${newId()}, ${u}, 't', 'o', '2024-01', 's', '{"a":1}')`,
    ],
    [
      'experience.skills = [true]',
      (u) =>
        sql`INSERT INTO experience (id, user_id, title, organization, start, summary, skills) VALUES (${newId()}, ${u}, 't', 'o', '2024-01', 's', '[true]')`,
    ],
    [
      'experience.start = banana',
      (u) =>
        sql`INSERT INTO experience (id, user_id, title, organization, start, summary) VALUES (${newId()}, ${u}, 't', 'o', 'banana', 's')`,
    ],
    [
      'experience.end = 2024-13',
      (u) =>
        sql`INSERT INTO experience (id, user_id, title, organization, start, \`end\`, summary) VALUES (${newId()}, ${u}, 't', 'o', '2024-01', '2024-13', 's')`,
    ],
    [
      'certifications.date = banana',
      (u) =>
        sql`INSERT INTO certifications (id, user_id, name, issuer, date) VALUES (${newId()}, ${u}, 'n', 'i', 'banana')`,
    ],
    [
      'projects.links = [{"label":"a"}]',
      (u) =>
        sql`INSERT INTO projects (id, user_id, title, links) VALUES (${newId()}, ${u}, 't', '[{"label":"a"}]')`,
    ],
    [
      'projects.files = {"a":1}',
      (u) =>
        sql`INSERT INTO projects (id, user_id, title, files) VALUES (${newId()}, ${u}, 't', '{"a":1}')`,
    ],
    [
      'activities.translation_params = [1]',
      (u) =>
        sql`INSERT INTO activities (id, user_id, type, translation_key, translation_params) VALUES (${newId()}, ${u}, 'project', 'k', '[1]')`,
    ],
    [
      'activities.translation_params = {"a":[1]}',
      (u) =>
        sql`INSERT INTO activities (id, user_id, type, translation_key, translation_params) VALUES (${newId()}, ${u}, 'project', 'k', '{"a":[1]}')`,
    ],
  ];

  it.each(cases)('rejects %s with 3819', async (_label, statement) => {
    const user = await createUser(db);
    expect(await errnoOf(statement(user.id).execute(db))).toBe(MysqlErrno.CHECK_VIOLATED);
  });

  it('accepts well-formed values and SQL NULL', async () => {
    const user = await createUser(db);
    const u = user.id;
    await sql`INSERT INTO projects (id, user_id, title, links, files) VALUES (${newId()}, ${u}, 't', '[{"label":"a","url":"https://x.dev"}]', NULL)`.execute(
      db,
    );
    await sql`INSERT INTO experience (id, user_id, title, organization, start, \`end\`, summary, skills) VALUES (${newId()}, ${u}, 't', 'o', '2024-01', NULL, 's', '["Go"]')`.execute(
      db,
    );
    await sql`INSERT INTO activities (id, user_id, type, translation_key, translation_params) VALUES (${newId()}, ${u}, 'project', 'k', '{"projectName":"X","n":2}')`.execute(
      db,
    );
  });
});

/** The unique keys 0003 and 0004 add, each rejecting a real duplicate. */
describe('unique keys', () => {
  const db = testDatabase();
  const errnoOf = (p: Promise<unknown>) => p.then(() => undefined, mysqlErrno);

  it('user_skills: one skill per user, case-insensitively (0003)', async () => {
    const user = await createUser(db);
    const other = await createUser(db);
    const insert = (userId: string, skillName: string) =>
      db.insertInto('userSkills').values({ id: newId(), userId, skillName }).execute();
    await insert(user.id, 'React');
    expect(await errnoOf(insert(user.id, 'react'))).toBe(MysqlErrno.DUPLICATE_KEY);
    expect(await errnoOf(insert(user.id, 'REACT'))).toBe(MysqlErrno.DUPLICATE_KEY);
    // Another user may have the same skill.
    expect(await errnoOf(insert(other.id, 'React'))).toBeUndefined();
  });

  it('projects: one import of a GitHub repository per user (0004)', async () => {
    const user = await createUser(db);
    const other = await createUser(db);
    const insert = (userId: string, githubRepoId: number | null) =>
      db
        .insertInto('projects')
        .values({ id: newId(), userId, title: 't', source: 'github', githubRepoId })
        .execute();
    await insert(user.id, 812345678);
    expect(await errnoOf(insert(user.id, 812345678))).toBe(MysqlErrno.DUPLICATE_KEY);
    // Another user may import the same repository; manual projects (NULL) never clash.
    expect(await errnoOf(insert(other.id, 812345678))).toBeUndefined();
    expect(await errnoOf(insert(user.id, null))).toBeUndefined();
    expect(await errnoOf(insert(user.id, null))).toBeUndefined();
  });
});

/** What 0006 adds for teams and notifications, and the team table facts M5 relies on (docs/modules/m5/plan §2.1). */
describe('teams and notifications schema (0006)', () => {
  const db = testDatabase();
  const errnoOf = (p: Promise<unknown>) => p.then(() => undefined, mysqlErrno);

  it('notifications.params must be a JSON object', async () => {
    const user = await createUser(db);
    const insert = (params: string) =>
      sql`INSERT INTO notifications (id, user_id, type, title, params) VALUES (${newId()}, ${user.id}, 'team_left', 't', ${params})`.execute(
        db,
      );
    expect(await errnoOf(insert('[1]'))).toBe(MysqlErrno.CHECK_VIOLATED);
    expect(await errnoOf(insert('"text"'))).toBe(MysqlErrno.CHECK_VIOLATED);
    expect(await errnoOf(insert('{"actorName":"A"}'))).toBeUndefined(); // and team_left is a type
  });

  it('team members: many named-only rows per project, one row per linked user (R1, R2)', async () => {
    const owner = await createUser(db);
    const other = await createUser(db);
    const projectId = newId();
    await db
      .insertInto('projects')
      .values({ id: projectId, userId: owner.id, title: 'p' })
      .execute();
    const add = (userId: string | null) =>
      db
        .insertInto('projectTeamMembers')
        .values({ id: newId(), projectId, userId, name: 'n', status: 'accepted' })
        .execute();
    expect(await errnoOf(add(null))).toBeUndefined();
    expect(await errnoOf(add(null))).toBeUndefined();
    expect(await errnoOf(add(other.id))).toBeUndefined();
    expect(await errnoOf(add(other.id))).toBe(MysqlErrno.DUPLICATE_KEY);
  });

  it('the newest-first lists read an index in order, with no filesort', async () => {
    const plan = async (table: string, column: string) => {
      const { rows } = await sql<{ key: string | null; Extra: string | null }>`
        EXPLAIN SELECT id FROM ${sql.table(table)} WHERE user_id = 'u' ORDER BY ${sql.ref(column)} DESC, id DESC LIMIT 20`.execute(
        db,
      );
      return rows[0]!;
    };
    const notifications = await plan('notifications', 'created_at');
    expect(notifications.key).toBe('idx_notifications_user_created');
    expect(notifications.Extra ?? '').not.toMatch(/filesort/i);
    const activities = await plan('activities', 'timestamp');
    expect(activities.key).toBe('idx_activities_user_ts');
    expect(activities.Extra ?? '').not.toMatch(/filesort/i);
  });
});

/**
 * What 0008 adds for GitHub connect (docs/m7-plan.md §2.6, §9, §10): no token
 * can be stored, one Gradfolio account per GitHub account, nonces and import
 * snapshots of the documented shape. Raw SQL, because the row types refuse a
 * token at compile time.
 */
describe('GitHub connect schema (0008)', () => {
  const db = testDatabase();
  const errnoOf = (p: Promise<unknown>) => p.then(() => undefined, mysqlErrno);

  it.each([
    ['access_token', sql`'gho_SENTINEL'`],
    ['refresh_token', sql`'ghr_SENTINEL'`],
    ['token_expires_at', sql`UTC_TIMESTAMP()`],
  ])('never stores %s: an insert and an update are refused with 3819', async (column, value) => {
    const user = await createUser(db);
    const id = newId();
    expect(
      await errnoOf(
        sql`INSERT INTO integrations (id, user_id, integration_type, ${sql.ref(column)}) VALUES (${id}, ${user.id}, 'github', ${value})`.execute(
          db,
        ),
      ),
    ).toBe(MysqlErrno.CHECK_VIOLATED);
    await sql`INSERT INTO integrations (id, user_id, integration_type) VALUES (${id}, ${user.id}, 'github')`.execute(
      db,
    );
    expect(
      await errnoOf(
        sql`UPDATE integrations SET ${sql.ref(column)} = ${value} WHERE id = ${id}`.execute(db),
      ),
    ).toBe(MysqlErrno.CHECK_VIOLATED);
  });

  it('one Gradfolio account per GitHub account; rows without a GitHub id never clash', async () => {
    const [a, b, c, d] = await Promise.all([1, 2, 3, 4].map(() => createUser(db)));
    const insert = (userId: string, externalUserId: string | null, status = 'linking') =>
      sql`INSERT INTO integrations (id, user_id, integration_type, status, external_user_id) VALUES (${newId()}, ${userId}, 'github', ${status}, ${externalUserId})`.execute(
        db,
      );
    await insert(a!.id, '583231');
    expect(await errnoOf(insert(b!.id, '583231', 'connected'))).toBe(MysqlErrno.DUPLICATE_KEY);
    expect(await errnoOf(insert(c!.id, null, 'not_connected'))).toBeUndefined();
    expect(await errnoOf(insert(d!.id, null, 'not_connected'))).toBeUndefined();
    // The same id under the other type is a different account.
    expect(
      await errnoOf(
        sql`INSERT INTO integrations (id, user_id, integration_type, external_user_id) VALUES (${newId()}, ${a!.id}, 'linkedin', '583231')`.execute(
          db,
        ),
      ),
    ).toBeUndefined();
  });

  it('a nonce is stored as a lowercase SHA-256 hex digest only', async () => {
    const user = await createUser(db);
    const insert = (hash: string) =>
      sql`INSERT INTO integration_nonces (hash, user_id, expires_at) VALUES (${hash}, ${user.id}, UTC_TIMESTAMP())`.execute(
        db,
      );
    expect(await errnoOf(insert('a'.repeat(64)))).toBeUndefined();
    expect(await errnoOf(insert('A'.repeat(64)))).toBe(MysqlErrno.CHECK_VIOLATED);
    expect(await errnoOf(insert('raw-nonce-value'))).toBe(MysqlErrno.CHECK_VIOLATED);
  });

  it('an import snapshot is an object of SHA-256 hex digests, and goes with its project', async () => {
    const user = await createUser(db);
    const projectId = newId();
    await db
      .insertInto('projects')
      .values({ id: projectId, userId: user.id, title: 'p' })
      .execute();
    const insert = (snapshot: string) =>
      sql`INSERT INTO project_github_imports (project_id, synced_at, snapshot) VALUES (${projectId}, UTC_TIMESTAMP(), ${snapshot})`.execute(
        db,
      );
    expect(await errnoOf(insert('{"title":"Kept as text"}'))).toBe(MysqlErrno.CHECK_VIOLATED);
    expect(await errnoOf(insert('["x"]'))).toBe(MysqlErrno.CHECK_VIOLATED);
    expect(await errnoOf(insert(JSON.stringify({ title: 'f'.repeat(64) })))).toBeUndefined();
    await db.deleteFrom('projects').where('id', '=', projectId).execute();
    const left = await db.selectFrom('projectGithubImports').selectAll().execute();
    expect(left).toEqual([]);
  });
});
