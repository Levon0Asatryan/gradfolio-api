# M1 plan: data layer, schema ownership, DB fixes

Tracker tasks 1.1–1.14. Decides **Q2** (who owns the schema) and **Q12** (query layer).
Nothing here is user-facing: M2 onwards reads and writes through it.

Every claim marked **run** was executed on 2026-09-28 against MySQL **8.4.11**
(`docker compose up -d mysql`, `TZ=Asia/Yerevan`) with the versions this repo pins or
would pin: mysql2 3.24.4, kysely 0.29.6, kysely-codegen 0.20.0, drizzle-orm 0.45.3,
drizzle-kit 0.31.11, prisma / @prisma/client / @prisma/adapter-mariadb 7.10.0,
TypeScript 6.0.3, Node 24.20. The scratch scripts ran outside the repo; the commands
and outputs that matter are quoted below.

## 1. Decisions

| ID       | Decision                                                                                                                                                                                                                    | Evidence |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q12      | **Kysely** on the existing `mysql2` pool, row types **generated** by kysely-codegen from the migrated database with per-column overrides, checked for drift in CI.                                                          | §2       |
| Q2       | **The API owns the schema.** Versioned `.sql` migrations in this repo, applied by **our own small runner** (one statement per step, each step recorded on success, guarded DDL). Baseline = `gradfolio-sql/sql/schema.sql`. | §3       |
| Q2 (sql) | `gradfolio-sql` stays as reference docs: `schema.sql` is frozen as the baseline snapshot, its README points to this repo's migrations, its compose/seed/queries are fixed (1.11–1.14).                                      | §3.5     |
| 1.6      | Project technologies and tags move from JSON columns into **`project_technologies` and `project_tags` tables** (utf8mb4_unicode_ci), plus UNIQUE `(user_id, skill_name)` on `user_skills`.                                  | §6       |
| 1.8      | CHECK constraints on every JSON column (**`JSON_SCHEMA_VALID`**, element shape, not only "is an array") and every `YYYY-MM` column (`REGEXP_LIKE`).                                                                         | §7       |
| 1.9      | Clean database **per test file by `DELETE`** (FK checks off), automatic via a Vitest `setupFiles` hook. No transaction-per-test.                                                                                            | §8       |
| 1.10     | TypeScript seed with fixed UUIDs, en/ru/am data, links built from those ids, owner never a team-member row; one transaction; idempotent.                                                                                    | §9       |

## 2. Q12: the query layer

### 2.1 What was run, per candidate

Same schema (`schema.sql` + `seed.sql`) for each. "Race" = two upserts on one
`auth0_id` forced to collide: a third connection inserts the same `auth0_id` in an open
transaction, both upserts start, the script polls `performance_schema.data_lock_waits`
until **2 waiters** are blocked (a barrier, no sleep), then the holder commits or rolls
back.

| Check                               | Kysely 0.29.6                                                                                                                                                                           | Drizzle 0.45.3                                                                                                                                                                   | Prisma 7.10.0                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Upsert SQL                          | `insert … on duplicate key update id = id`, then `SELECT … WHERE auth0_id = ?`                                                                                                          | same SQL; `$returningId()` returns `[]` for an app-supplied `CHAR(36)` id                                                                                                        | **`SELECT` then `INSERT`/`UPDATE` in the app** (query log: `SELECT users.id … WHERE auth0_id = ?`, then insert) |
| Race, holder **commits**            | both OK, same id (raw-SQL run, 3/3; identical SQL to Kysely/Drizzle)                                                                                                                    | same                                                                                                                                                                             | **both fail `P2002`** (unique violation), 3/3                                                                   |
| Race, holder **rolls back**         | one OK, other **`1213` deadlock**                                                                                                                                                       | one OK, other `1213`                                                                                                                                                             | one OK, other `P2034` (deadlock)                                                                                |
| JSON read                           | parsed arrays/objects (driver)                                                                                                                                                          | parsed; typed via `json().$type<T>()`                                                                                                                                            | parsed; type `JsonValue` (untyped)                                                                              |
| JSON write                          | **array param → `ER_WRONG_VALUE_COUNT_ON_ROW` 1136** (mysql2 expands arrays); `JSON.stringify` needed                                                                                   | stringifies itself; **`{"a":1}` into a `string[]` column accepted**                                                                                                              | accepts any JSON; `{"a":1}` accepted                                                                            |
| `TINYINT(1)`                        | **`1` (number)** by default; `true` with a mysql2 `typeCast` (run both)                                                                                                                 | `boolean()` column → boolean                                                                                                                                                     | `Boolean` in the model; **`$queryRaw` returns `1`**                                                             |
| Multi-statement transaction + throw | both statements rolled back                                                                                                                                                             | both rolled back                                                                                                                                                                 | both rolled back                                                                                                |
| Raw `MATCH … AGAINST`               | `sql\`MATCH(…) AGAINST(${q} …)\`` bound, score is number                                                                                                                                | same                                                                                                                                                                             | `$queryRaw` works; native `search:` needs `@@fulltext` in the model                                             |
| Row types                           | kysely-codegen from the DB: `TINYINT(1)`→`number`, JSON→`JsonValue`, `id: Generated<string>`; **per-column overrides work; `--verify` exits 1 after an `ALTER TABLE users ADD COLUMN`** | `drizzle-kit pull` output **does not compile** (`default(')` for `DEFAULT ''`), turns FULLTEXT into plain `index()`, drops `ON UPDATE CURRENT_TIMESTAMP`, `TINYINT(1)`→`tinyint` | `db pull`: `Boolean` ✓, `@@fulltext` ✓, **`ON UPDATE CURRENT_TIMESTAMP` dropped** (`@default(now())` only)      |

Upsert race, raw mysql2 (the SQL Kysely and Drizzle emit), 5 runs × 3 repeats each,
**90 barrier waits, no flake** (**run**):

```
commit    odku / plain+catch 1062 / insert ignore   ok / ok      (every run)
rollback  odku / plain+catch 1062 / insert ignore   ok / ERR 1213 (every run)
```

A rolled-back competing insert makes InnoDB deadlock one waiter whatever the SQL style.
So "race-safe upsert" on MySQL means: `ON DUPLICATE KEY UPDATE` + re-read + **retry the
whole transaction on 1213** (bounded).

Two more facts for M2 (Q7), **run**:

- Inside a transaction that has already read (REPEATABLE READ snapshot), a competing
  commit, then our ODKU (`affectedRows` 1), then a plain re-read returns **0 rows**;
  `SELECT … FOR SHARE` returns the row. Upsert-then-read runs outside a transaction or
  re-reads with `FOR SHARE`.
- mysql2 sets `CLIENT_FOUND_ROWS`: a no-op ODKU reports `affectedRows` 1, so the count
  cannot tell insert from no-op. The re-read is what returns the row.

### 2.2 Other candidates

- **Raw mysql2 + hand-written row types:** everything Kysely gives minus composition and
  typed columns. All the driver facts above apply equally. Rejected: no drift check.
- TypeORM and MikroORM were **not run**. They are entity/decorator ORMs whose migration
  tools rest on the same transactional assumption as §3.2's; nothing here needs an
  identity map. Not evaluated further.

### 2.3 Recommendation: Kysely

- It is SQL-shaped: ODKU, JSON functions, `MATCH … AGAINST`, `FOR SHARE`, optimizer
  hints all go through `sql\`\`` with bound parameters.
- Types come from the migrated database (§3 makes migrations the source of truth), with
  overrides that encode our rules, and `kysely-codegen --verify` fails CI on drift.
- Prisma is out: its MySQL upsert is not race-safe (both racers fail `P2002`), its
  migrator has no down steps, JSON is untyped.
- Drizzle is viable as a builder, but its type source is a hand-written TS schema
  whose own introspection is lossy on this schema, and its migrator fails §3.2.

**What it costs** (each becomes code plus a test in PR b):

| Cost                                                                                                                                       | Handled by                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `TINYINT(1)` arrives as `1`                                                                                                                | pool `typeCast`: `TINY` with length 1 → boolean (**run**: `isPublic true boolean`)                                                     |
| JSON params must be strings; array params break (1136)                                                                                     | `toJsonColumn(schema, value)`: zod-parses, then stringifies to a **branded** `JsonText<T>`; column insert types accept only that brand |
| `CamelCasePlugin` default **rewrites keys inside JSON values** (**run**: `{"project_name"}` → `{"projectName"}`)                           | `new CamelCasePlugin({ maintainNestedObjectKeys: true })` (**run**: keys preserved) + int test                                         |
| `DATE` becomes a JS `Date`; with the default local zone it shifts a day (**run**: `2002-03-15` → `2002-03-14T20:00Z` under `Asia/Yerevan`) | `dateStrings: ['DATE']` → `'2002-03-15'` (**run**); `DATETIME` stays `Date` with `timezone: 'Z'`                                       |
| Kysely needs the **callback** pool; given the `mysql2/promise` pool, queries **hang** silently (kysely#1465; **run**: pending after 3 s)   | `new MysqlDialect({ pool: promisePool.pool })` (**run**: works) + int test that a query returns                                        |
| Types can drift from the database                                                                                                          | `npm run db:types` / `db:types:check` (`--verify`) in the CI migrations job                                                            |

**What we give up:** relation loading, generated CRUD, schema-from-code migrations.
Joins and nested reads are written by hand. At tens of users that is fine.

Published issues checked: kysely#1722/#1739 (types vs mysql2 ≥ 3.18) are closed;
**run** `tsc` (skipLibCheck off) on `new MysqlDialect({ pool: createPool(…).pool })`
with 3.24.4: exit 0. mysql2#1336 (connection `timezone` does not affect
`CURRENT_TIMESTAMP`) is why the pool already pins the session `time_zone`. mysql2 adds
`IGNORE_SPACE` to the session `sql_mode` (**run**); none of our column names is on the
affected function list, and the baseline diff (§4) proves it changes no DDL.

## 3. Q2: schema ownership and the migration runner

### 3.1 The constraint

MySQL commits DDL implicitly, so a migration cannot be a transaction. What MySQL 8.4
does give (**run**):

- A single `ALTER TABLE` with several clauses is **atomic**: `ADD COLUMN c, ADD COLUMN b`
  where `b` exists fails with 1060 and **`c` is not added**.
- Native guards exist only for tables: `CREATE TABLE IF NOT EXISTS` (note 1050),
  `DROP TABLE IF EXISTS` (note 1051). `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT
EXISTS`, `DROP INDEX IF EXISTS`, `DROP COLUMN IF EXISTS`, `DROP CHECK IF EXISTS` and
  `DROP CONSTRAINT IF EXISTS` are all **syntax errors (1064)**. Re-running them gives
  1060 / 1061 / 3822 / 3821.

### 3.2 A failing two-step migration, per option (**run**)

Step 1 `CREATE TABLE step_one`, step 2 `ALTER TABLE does_not_exist …` (1146). Then step 2
is fixed and the tool re-run.

| Option                     | Run 1                                                                                   | Run 2 (fixed)                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Kysely `Migrator`          | 1146; `step_one` exists; `kysely_migration` empty                                       | **1050 `step_one` already exists**; stuck until someone drops it by hand                                     |
| drizzle `migrate()`        | logs `begin`, step 1, step 2, **`rollback`**; `step_one` still exists; nothing recorded | **1050**; stuck                                                                                              |
| `prisma migrate deploy`    | P3018; `step_one` exists; row with `finished_at NULL`                                   | **P3009** "failed migrations in the target database"; after `migrate resolve --rolled-back`: **1050**; stuck |
| **Own runner (prototype)** | step 1 executed **and recorded**; step 2 fails                                          | step 1 skipped (recorded), step 2 applied, recorded → `step_one.id, step_one.x`                              |
| Own runner, crash window   | step 2 executed, process killed **before** recording it                                 | step 2's `information_schema` guard sees the column → recorded without re-running                            |

None of the tools records progress below the migration, and none has SQL down steps
(Prisma has none at all). Flyway and dbmate were not run: a JVM or Go binary in a Node
image for a job this small is not worth it.

### 3.3 The runner

`src/core/db/migrator/`, modelled on probeboard-api's (files, registry, runner, CLI) but
built for MySQL's implicit commit.

**Files.** `src/core/db/migrations/NNNN_name.up.sql` and `.down.sql`, copied into `dist`
by the Nest build (`assets`), so the runtime image can migrate.

- A file is split into **steps** on `;` at the end of a line. **One statement per
  step.** Semicolons inside a line (string literals) are allowed.
- A step may start with `-- skip-if: <SELECT>`. The runner executes the SELECT; a row
  means "already in effect": the step is recorded without executing it.
- **Every step must be re-runnable**, checked by a unit test over all files: it is
  `CREATE TABLE IF NOT EXISTS`, `DROP TABLE IF EXISTS`, idempotent DML (`INSERT … ON
DUPLICATE KEY UPDATE`, a deterministic `UPDATE`), or it has a `skip-if` guard.
  `ALTER`, `CREATE INDEX`, `DROP INDEX` without a guard fail the test.

**Registry.** Created by the runner (`CREATE TABLE IF NOT EXISTS`):

```sql
schema_migrations (
  name       VARCHAR(255) NOT NULL,
  direction  ENUM('up','down') NOT NULL,
  step       INT NOT NULL,
  checksum   CHAR(64) NOT NULL,        -- sha256 of the step's SQL
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name, direction, step)
)
```

**State of a migration** from its rows: none = pending; some `up` = partially applied;
all `up` = applied; `up` + some `down` = partially rolled back.

**`up [--to <name>]`**, in name order:

1. Takes `GET_LOCK('gradfolio_migrate', MIGRATION_LOCK_TIMEOUT_S)` on its one
   connection; not granted → exits 1 "another migration is running". The lock belongs
   to the session, so a killed runner releases it.
2. Refuses if the database records a migration the build does not have ("database is
   ahead of this build").
3. Refuses if a recorded step's checksum differs from the file ("`0001_baseline` step 3
   changed after it was applied").
4. Refuses a partially rolled-back migration ("finish `migrate:down` first").
5. For each pending or partial migration, for each unrecorded step: run the guard, run
   the statement, then **immediately** `INSERT` its record (autocommit). A failure
   stops the run, naming the migration, step and MySQL error; exit 1.
6. Nothing to do → prints `migrations: nothing to apply`, exit 0.

**`down [--all | --to <name>]`** (default: the latest migration with any rows): runs
its unrecorded `down` steps, recording each; when all are recorded, deletes every row
of that migration in one statement. A partially applied migration is rolled back the
same way; the guards make undoing absent parts a no-op. A crash anywhere leaves a state
the next `down` resumes.

**Connection.** Built from the same `poolOptions` (TLS, UTC session) as the app, one
connection, `multipleStatements` off.

**Commands.** `npm run migrate`, `npm run migrate:down` (tsx, reads `.env`);
`node dist/core/db/migrator/cli.js up|down` in the image. Config:
`MIGRATION_LOCK_TIMEOUT_S` (default 60) in `src/core/config/schema.ts`.

### 3.4 Migrations in M1

| Migration             | Up steps                                                                                                                                                                                                                                                                                               | Down steps                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_baseline`       | 11 × `CREATE TABLE IF NOT EXISTS`, text identical to `schema.sql` otherwise (1.2)                                                                                                                                                                                                                      | 11 × `DROP TABLE IF EXISTS`, children first                                                                                                                |
| `0002_value_checks`   | one guarded `ALTER TABLE … ADD CONSTRAINT … CHECK …` per table (education, experience, certifications, projects, activities); §7                                                                                                                                                                       | one guarded `ALTER TABLE … DROP CHECK …` per table                                                                                                         |
| `0003_project_terms`  | `CREATE TABLE IF NOT EXISTS project_technologies`, `… project_tags`; backfill each from the JSON column (`INSERT … SELECT … JSON_TABLE … ON DUPLICATE KEY UPDATE`); guarded `ALTER TABLE projects DROP COLUMN tags, DROP COLUMN technologies`; guarded UNIQUE `(user_id, skill_name)` on `user_skills` | re-add both JSON columns and their CHECKs (guarded); backfill them from the tables (ordered, below); drop the UNIQUE (guarded); `DROP TABLE IF EXISTS` × 2 |
| `0004_project_source` | one guarded `ALTER TABLE projects ADD …` (1.7, §3.6)                                                                                                                                                                                                                                                   | one guarded `ALTER TABLE projects DROP …`                                                                                                                  |

Facts behind 0003 (**run**): dropping a column also drops its single-column CHECK
(`DROP CHECK x, DROP COLUMN c` fails 3821, `DROP COLUMN c` alone succeeds); the down
backfill builds each array with `GROUP_CONCAT(JSON_QUOTE(name) ORDER BY sort_order)`
under `/*+ SET_VAR(group_concat_max_len = 1048576) */`, because `JSON_ARRAYAGG`'s order
is undefined and the 1024-byte default truncates (**run**: with the hint at 4,
`GROUP_CONCAT('abcdef')` = `abcd`). 0002 runs before 0003, so a malformed `tags` value
stops the migration **before** the column holding it is dropped.

### 3.5 gradfolio-sql, the seed and demo data

- `schema.sql` stays as the frozen baseline snapshot (1.2 is proved against it, and CI
  keeps proving it at a pinned commit, §4). Its README becomes a pointer: "the schema
  is owned by gradfolio-api's migrations; this repo is reference documentation".
- Its per-table docs stay (useful), corrected (S2, S13). Later schema changes are
  documented in this repo's migrations, not there.
- Seed and demo data flow through this repo: `npm run db:seed` after `npm run migrate`
  (§9). The `gradfolio-sql` seed is fixed (S11, S12, absolute file URLs) so its compose
  still works standalone, but it is not the source of demo data.

### 3.6 v1 schema additions (1.7)

`projects` gains, in one atomic `ALTER TABLE`:

| Column           | Type                                                | Why                                                               |
| ---------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `source`         | `ENUM('manual','github') NOT NULL DEFAULT 'manual'` | spec §2 import; the GitHub badge (7.12)                           |
| `github_repo_id` | `BIGINT UNSIGNED NULL`                              | dedupe on import (7.3); GitHub repo ids are integers              |
| `repo_stars`     | `INT UNSIGNED NULL`                                 | spec §2; the frontend's `githubStars`                             |
| `repo_forks`     | `INT UNSIGNED NULL`                                 | spec §2                                                           |
| `repo_language`  | `VARCHAR(100) NULL`                                 | spec §2                                                           |
| `is_draft`       | `TINYINT(1) NOT NULL DEFAULT 0`                     | imported projects start as drafts (7.3); manual ones are not      |
| UNIQUE           | `uq_projects_user_repo (user_id, github_repo_id)`   | one import per repo per user; NULLs (manual projects) never clash |

A draft is readable by its owner only; M4 applies that on every read path (with Q3).
Team re-invite rules wait for Q4 (M5), as the handoff says.

## 4. Baseline equivalence (1.2)

Database A gets `schema.sql` through the `mysql` CLI; database B gets only
`0001_baseline` through the runner (`migrate --to 0001_baseline`). Then a normalized
`SHOW CREATE TABLE` of every base table except `schema_migrations`, sorted by name, with
`AUTO_INCREMENT=n` removed, is diffed. Prototype (**run**, 11 tables each):

```sh
dump() { for t in $(mysql -N -B -e "SELECT table_name FROM information_schema.tables
    WHERE table_schema='$1' AND table_type='BASE TABLE' AND table_name <> 'schema_migrations'
    ORDER BY table_name"); do
  mysql -N -B --raw "$1" -e "SHOW CREATE TABLE \`$t\`" | cut -f2- | sed -E 's/ AUTO_INCREMENT=[0-9]+//'; echo
done; }
diff <(dump eq_a) <(dump eq_b) && echo "DIFF EMPTY"     # -> DIFF EMPTY
# negative control: ALTER TABLE eq_b.projects DROP INDEX idx_projects_status
# -> 155d154 <   KEY `idx_projects_status` (`status`),   (exit 1)
```

In the repo this becomes `src/core/db/migrator/schema-dump.ts` (same normalization, via
mysql2), used by: the integration test for 1.2, the CI migrations job (up → down → up is
identical) and `docs/m1-verification.md`. The CI job fetches `schema.sql` from the
public `gradfolio-sql` repo **at a pinned commit** and runs the diff, so the baseline
can never drift unnoticed.

## 5. Validators (1.5)

Pure zod in `src/core/validation/` (depends only on zod, so `core` stays independent).

### 5.1 Lengths (**run**, utf8mb4, strict mode)

| Value into `users.headline VARCHAR(500)` | JS `.length`    | Code points | MySQL                      |
| ---------------------------------------- | --------------- | ----------- | -------------------------- |
| 500 × `a` / 501 × `a`                    | 500 / 501       | 500 / 501   | OK / **1406**              |
| 500 × `Ա` (2 bytes each) / 501           | 500 / 501       | 500 / 501   | OK (1000 bytes) / **1406** |
| 500 × `😀` (4 bytes) / 501               | **1000** / 1002 | 500 / 501   | OK (2000 bytes) / **1406** |
| 500 × `e` + U+0301                       | 1000            | 1000        | **1406**                   |

| Into `users.bio TEXT`                  | MySQL    |
| -------------------------------------- | -------- |
| 65,535 ASCII / 16,383 emoji (65,532 B) | OK       |
| 65,536 ASCII / 16,384 emoji (65,536 B) | **1406** |

So: **`VARCHAR(n)` counts code points** (`[...s].length`); `z.string().max(n)` counts
UTF-16 units and would reject 300 emoji that MySQL accepts. **`TEXT` counts UTF-8
bytes** (`Buffer.byteLength(s) <= 65535`). Builders: `varchar(n)`, `text()`,
`mediumtext()`, `longtext()`. A `COLUMN_LIMITS` map (table.column → kind and limit) is
checked against `information_schema.columns` by an integration test, so a migration
that changes a length fails until the map follows.

### 5.2 JSON and `YYYY-MM` columns (D5)

| Column                                                                                             | Shape                                      | zod                                                                |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `education.highlights`                                                                             | `string[]` or NULL                         | `stringList({ maxItems, itemMax })`, items trimmed, non-empty      |
| `experience.achievements`                                                                          | `string[]` or NULL                         | `stringList(…)`                                                    |
| `experience.skills`                                                                                | `string[]` or NULL                         | `termList(…)`: `stringList` + term normalization (§6), deduped     |
| `projects.links`                                                                                   | `{label, url}[]` or NULL                   | `linkList(…)`: `label` non-empty, `url` = `httpUrl`                |
| `projects.files`                                                                                   | `{label, url}[]` or NULL                   | `linkList(…)`                                                      |
| `activities.translation_params`                                                                    | `Record<string, string \| number>` or NULL | `z.record(z.string(), z.union([z.string(), z.number().finite()]))` |
| `projects.tags`, `projects.technologies`                                                           | moved to tables (§6)                       | `termList(…)`                                                      |
| `experience.start` (NOT NULL), `experience.end` (NULL = present), `certifications.date` (NOT NULL) | `YYYY-MM`                                  | `yearMonth`: `/^\d{4}-(0[1-9]\|1[0-2])$/`                          |

`httpUrl`: parsed with `new URL`; protocol must be `http:` or `https:`
(`javascript:`, `data:`, `ftp:` and relative paths rejected); length per its column.
Endpoint DTOs in M3/M4 compose these; item-count caps are M3/M4 product choices.

Writes to JSON columns go through `toJsonColumn(schema, value)`, whose branded return
type is the only thing the generated insert/update types accept. A plain
`JSON.stringify` does not compile (a `@ts-expect-error` test proves it).

## 6. Tags (1.6)

### 6.1 Evidence (**run**, 504 projects, 1,516 technology rows)

| Query                                                                                  | Result                              | Plan                                                   |
| -------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| JSON: `JSON_CONTAINS(technologies, JSON_QUOTE('react'))`                               | 25 (misses `React`, case-sensitive) | `ALL`, 504 rows                                        |
| JSON: `EXISTS (SELECT 1 FROM JSON_TABLE(p.technologies …) jt WHERE jt.t = ?)`, `React` | **0 (wrong; true answer 126)**      | `jt:ref <auto_key0>` **before** `p:ALL`                |
| same with `LOWER(jt.t) = LOWER(?)`, or the `? IN (SELECT jt.t …)` form                 | **0**                               | same                                                   |
| same, `SET optimizer_switch='semijoin=off'`                                            | 126                                 | `p:ALL`, then `jt:ref`                                 |
| JSON: comma join `projects p, JSON_TABLE(…) jt … COUNT(DISTINCT p.id)`                 | 126                                 | `p:ALL`, `jt:ref`                                      |
| JSON + multi-valued index `CAST(technologies AS CHAR(100) ARRAY)`, `'react' MEMBER OF` | 25 (case-sensitive)                 | `ref mvi_tech`                                         |
| JSON tag cloud via `JSON_TABLE` … `GROUP BY name`                                      | correct                             | `ALL` + temporary + filesort                           |
| **Table**: `JOIN project_technologies pt … WHERE pt.name = 'react'`                    | **126** (case-insensitive)          | `pt:ref idx_pt_name` (Using index), `p:eq_ref PRIMARY` |
| **Table** tag cloud `GROUP BY name`                                                    | correct                             | `index idx_pt_name`                                    |

MySQL 8.4.11 returns a **wrong result** for a correlated semijoin over `JSON_TABLE`: the
optimizer materializes the table function before the outer row it depends on. The JSON
design needs every query author to avoid that form; the table design has no such trap,
matches case-insensitively through the column collation, and uses an index. At this
scale speed is irrelevant (every query < 1 ms); correctness decides.

Collation facts (**run**, `utf8mb4_unicode_ci`): `React`=`react`, `Ա`=`ա`,
`Питон`=`питон`, `C#`=`c#`, `Go`=`GO`, **`Café`=`Cafe`** (accent-insensitive), **`React `=`React`**
(PAD SPACE).

### 6.2 Design

```sql
project_technologies (          -- project_tags: same shape
  project_id CHAR(36) NOT NULL,
  name       VARCHAR(255) NOT NULL,       -- utf8mb4_unicode_ci (table default)
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, name),         -- one per project, case-insensitively
  INDEX idx_project_technologies_name (name),
  CONSTRAINT fk_project_technologies_project FOREIGN KEY (project_id)
    REFERENCES projects (id) ON DELETE CASCADE
)
```

`VARCHAR(255)` matches `user_skills.skill_name`: skills and technologies share one
clickable-tag namespace (spec §4, "Technologies/Skills Used … clickable").
`experience.skills` stays JSON (a display list inside one entry, never matched).

**The rule.** `normalizeTerm`: NFC, trim, collapse internal whitespace; empty is
rejected. **Stored in canonical case**: on write, a term that already exists
case-insensitively in `user_skills`, `project_technologies` or `project_tags` is stored
in its most-used existing spelling (`canonicalizeTerms(db, names)`); a new term is
stored as entered. **Matched case-insensitively**: by the collation, never by
`JSON_CONTAINS`. Duplicates within one list collapse to the first (the primary key
decides, so it agrees with the collation exactly). Two concurrent first writers of
`react` and `React` can both store their own spelling; matching is unaffected, and the
tag cloud groups by the collation.

## 7. CHECK constraints (1.8)

**Run** on MySQL 8.4.11:

- `ADD CONSTRAINT … CHECK` on a table whose rows violate it: **3819, and no constraint is
  added** (`information_schema.check_constraints` count 0). The ALTER is atomic.
- After fixing the rows, the same ALTER succeeds.
- `JSON_SCHEMA_VALID` is allowed in a CHECK and enforces element shape: `[1,2]` into a
  `string[]` column → 3819; `[{"label":"a"}]` (no `url`) → 3819;
  `[{"label":"a","url":"https://x"}]` OK.
- The JSON literal `null` is rejected too (`JSON_TYPE(col) = 'ARRAY'`: 3819;
  `JSON_SCHEMA_VALID('{"type":"array",…}', 'null')` = 0), so SQL NULL is the only "no
  value".
- The `translation_params` schema below accepts `{"projectName":"X","n":2}` and rejects
  `{"a":[1]}` and `[1]`; added to the seeded `activities` table, it passes.
- `REGEXP_LIKE(date, '^[0-9]{4}-(0[1-9]|1[0-2])$')` rejects `banana` and `2023-13`
  (3819).

Constraints (`ck_<table>_<column>`):

| Column(s)                                                                                                        | Expression                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `education.highlights`, `experience.achievements`, `experience.skills`, `projects.tags`, `projects.technologies` | `col IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', col)`                                                                                             |
| `projects.links`, `projects.files`                                                                               | `col IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"object","required":["label","url"],"properties":{"label":{"type":"string"},"url":{"type":"string"}}}}', col)` |
| `activities.translation_params`                                                                                  | `col IS NULL OR JSON_SCHEMA_VALID('{"type":"object","additionalProperties":{"type":["string","number"]}}', col)`                                                                  |
| `experience.start`, `experience.end`, `certifications.date`                                                      | `col IS NULL OR REGEXP_LIKE(col, '^[0-9]{4}-(0[1-9]\|1[0-2])$')`                                                                                                                  |

The CHECKs are defence in depth for shape. URL schemes and lengths stay the API's job.

**Existing rows.**

- Fresh databases: the API seed and the fixed `gradfolio-sql` seed load after all
  migrations (tested).
- An existing database (Aiven, M9): each CHECK step fails with 3819 and changes nothing
  if a row violates it. The runner stops naming the step. The fix is to correct the rows
  (a read-only audit query per constraint sits in the migration's header comment), then
  re-run. No automatic data rewriting: that would be silent data loss.
- 0003 drops `tags`/`technologies` only after 0002's CHECK proved them arrays of strings,
  and its backfill inserts with strict mode on, so an over-long name fails (1406) rather
  than being truncated.

## 8. Test helpers (1.9)

Isolation, **run** (11 tables, seed loaded, 20 runs, median):

| Method                                 | Cost       |
| -------------------------------------- | ---------- |
| `TRUNCATE` 11 tables (FK checks off)   | **180 ms** |
| `DELETE FROM` 11 tables                | **9.5 ms** |
| `DELETE FROM users` (cascade)          | 1.4 ms     |
| `BEGIN` + insert + `ROLLBACK` per test | 0.6 ms     |

Transaction-per-test is fastest but wrong here: the app's pool hands requests other
connections outside the test transaction; barrier tests need several connections;
migration tests run DDL, which commits. **Chosen:** `DELETE FROM` every base table
except `schema_migrations`, FK checks off for that session, in a `beforeAll` installed
by the integration config's `setupFiles`, so **every file starts clean** without
opting in.

`src/testing/`:

- `global-setup.ts`: migrates `gradfolio_test` to the latest migration once per run.
- `database.ts` (extended): `testDatabase()` (Kysely on the test URL),
  `resetDatabase()`, `adminDatabaseUrl()` (root, `TEST_ADMIN_DATABASE_URL`, default
  `mysql://root:root@127.0.0.1:3307`), `scratchDatabase()` (creates and drops a
  throwaway database for migration tests).
- `barrier.ts`: `waitForLockWaiters(n)` polls `performance_schema.data_lock_waits` on an
  admin connection. The app user cannot read it (**run**: 1142).
- `factories.ts`: `createUser`, `createProfile` (a user plus education, experience,
  certifications, skills) and `createProject` (with technologies, tags, attachments).
  Every one generates its UUIDs in the app and returns the stored row.

## 9. Seed (1.10)

`src/core/db/seed/`: data module plus `cli.ts`; `npm run db:seed`, or
`node dist/core/db/seed/cli.js` in the image.

- Refuses on `NODE_ENV=production` and when migrations are pending.
- One transaction: deletes the seed's own users by their fixed ids (cascades), then
  inserts. Re-running gives the same rows; nobody else's rows are touched.
- Fixed UUIDs, so every notification `link` and `reference_id` is built from a real id
  (`/projects/<uuid>`) (S12).
- Owner rule (S11): **the owner never has a `project_team_members` row**. This follows
  the tracker's proposed Q4; if M5 decides otherwise, the seed changes in one place.
- Realistic en/ru/am content: about 6 students (Armenian, Russian and English names,
  headlines and bios), education at NPUA, YSU and AUA, experience, certifications,
  skills, 8 projects across categories (one GitHub-sourced draft), attachments, one
  external teammate, pending/accepted/rejected invites, activities, notifications.
- Every JSON and `YYYY-MM` value passes the zod validators (a unit test runs them over
  the seed data) and the CHECKs (the integration test loads it).

## 10. Compose and CI

- **Compose:** a `migrate` service (same image, `node dist/core/db/migrator/cli.js up`,
  `restart: "no"`, after `mysql` is healthy); `api` depends on it with
  `service_completed_successfully`. `docker compose up -d --build` yields a migrated
  schema. The existing `TZ=Asia/Yerevan` stays.
- **New CI job `migrations`** (MySQL 8.4 service, `TZ=Asia/Yerevan`):
  1. `npm run migrate`: prints each applied migration;
  2. `npm run migrate` again: must print `migrations: nothing to apply`;
  3. schema snapshot A;
  4. `npm run migrate:down -- --all`: only `schema_migrations` is left, and it is empty;
  5. `npm run migrate`, snapshot B, `diff A B` must be empty;
  6. baseline equivalence against `schema.sql` at the pinned `gradfolio-sql` commit;
  7. `npm run db:types:check`;
  8. `npm run db:seed` loads.
- **Integration job:** gets `TEST_ADMIN_DATABASE_URL`; global setup migrates the test
  database.
- **Stack job:** also checks the `migrate` container exited 0 and that
  `docker compose run --rm migrate` prints `nothing to apply`.

## 11. Security and correctness properties, and their proofs

Every guard ships with a test that fails when the guard is removed (Phase 3 table).

| Property                                                       | Test that fails without it                                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Each step is recorded as soon as it succeeds                   | int: a two-step migration whose step 2 fails leaves step 1 recorded; the re-run completes             |
| Guards close the crash window                                  | int: step executed, record deleted by the test, re-run → guard skips it, records it                   |
| Every step is re-runnable                                      | unit: an unguarded `ALTER` in a fixture migration fails the lint                                      |
| Applied steps are immutable                                    | int: change a recorded step's SQL → `up` refuses                                                      |
| An older build cannot migrate a newer database                 | int: an unknown recorded migration → `up` refuses                                                     |
| Two runners cannot interleave                                  | int: the test holds `GET_LOCK`, `up` with a 0 s timeout exits "another migration is running"          |
| Down resumes after a partial failure                           | int: failing down step; the re-run completes; the schema snapshot equals the pre-migration one        |
| Baseline = `schema.sql`                                        | int + CI: normalized diff is empty                                                                    |
| up → down → up is identical                                    | CI job step 5                                                                                         |
| `TINYINT(1)` is boolean; JSON keys kept; DATE is a string      | int against the real driver                                                                           |
| Ids are generated in the app                                   | type test: an insert without `id` does not compile; int: the stored id is the one generated           |
| JSON writes are validated                                      | type test: `JSON.stringify` output is not accepted; unit: each shape rejects the wrong one            |
| Validator limits equal the real column limits                  | int: `COLUMN_LIMITS` vs `information_schema`; unit: 500 emoji pass `varchar(500)`, 501 fail           |
| URL schemes are http/https only                                | unit: `javascript:`, `data:`, relative → rejected                                                     |
| Tags match case-insensitively and store the canonical spelling | int: `React` stored, `react` written → stored as `React`, and a lookup by `REACT` finds both projects |
| Each CHECK                                                     | int: `{"a":1}` into a JSON column, `banana` into a month column → MySQL 3819 (real transport)         |
| MySQL error mapping (1062, 1213, 3819, 1406)                   | int: each code produced by a real statement, mapped by `mysqlErrno`                                   |
| `inTransaction` retries a deadlock victim                      | int: a deadlock forced with the barrier; the retried transaction commits once                         |
| Every test file starts clean                                   | int: two files; the second sees no rows from the first                                                |
| Seed links resolve                                             | int: every notification `reference_id` joins a real project and its `link` = `/projects/<that id>`    |

## 12. Pull requests

1. **This plan** (docs only).
2. **(a) Migration runner and baseline:** runner + CLI, `0001_baseline`, schema dump,
   Nest `assets`, Dockerfile, compose `migrate` service, CI `migrations` job, stack job
   checks, test global setup and scratch-database helpers.
3. **(b) Query layer and the rest of the data layer:** Kysely + codegen types and
   column types, pool `typeCast`/`dateStrings`, `toJsonColumn`, ids, MySQL error
   mapping, `inTransaction`, validators, term normalization, migrations 0002–0004, test
   factories and barrier, per-file reset, seed, CLAUDE.md updates (commands, facts), and
   `docs/m1-verification.md`.
4. **gradfolio-sql** (one PR, own worktree): S1 compose mounts only `01-schema.sql` and
   `02-seed.sql` from a dedicated init folder; S2/S13 docs (11 tables, the id comment,
   "the backend supplies ids"); README → pointer to this repo's migrations; S3–S6
   `queries.sql` fixed (owner scoping, `is_public`, transaction) and marked illustrative;
   S11/S12 seed (owner rule, links from real ids, absolute file URLs).

## 13. Contradictions found

1. **Q4 vs S11 (1.14).** The seed needs an owner rule now; Q4 is decided in M5. The
   plan applies the tracker's proposed Q4 (owner implicit) and says so; M5 may flip it.
2. **1.6 names one table** (`project_technologies`); tags have the same trap, so there
   are two tables and the JSON columns are dropped.
3. **CLAUDE.md "Facts"** says the database has no CHECK constraints and that only the
   API validates; after 0002 that is false. PR (b) updates it (and "the query layer is
   still an M0 decision").
4. **1.1 "one DDL statement per step"**: MySQL makes a multi-clause `ALTER TABLE`
   atomic, so one such statement is one step. Consistent with the rule, stated here so
   review does not read it as a violation.
5. **Seed file URLs** (`/uploads/spec.pdf`) violate the http/https rule; both seeds get
   absolute URLs.
6. **9.8 (demo data)** overlaps 1.10: after M1, 9.8 is only "load or reset it on
   Aiven".
7. Investigation §3.2 is confirmed, not contradicted. New facts beyond it: the
   `JSON_TABLE` semijoin wrong result, 1213 on every upsert style under a rolled-back
   competitor, and the RR-snapshot re-read.

## 14. Out of scope

Endpoints and user-facing features (M2+); Q3–Q11; the team re-invite rule (Q4, M5); the
upsert helper for `/v1/me` (M2 builds it on `inTransaction` and §2.1's facts); applying
migrations to Aiven (M9, 9.1: run the §4 diff there first); URL-scheme CHECKs on scalar
columns (the API validates them).

## 15. Proposed tracker changes (for the orchestrator)

- Q2, Q12 → decided, per §1.
- 1.6 text: "two tables (`project_technologies`, `project_tags`); JSON columns dropped".
- 1.8: no longer "optional".
- 9.1: "run the baseline diff against Aiven before its first `migrate`".
- New follow-up for M2 (Q7): upsert = ODKU + re-read outside the transaction or with
  `FOR SHARE`, inside `inTransaction` (1213 retry).
- AGENTS.md "MySQL specifics", proposed additions: never a correlated `EXISTS`/`IN`
  over `JSON_TABLE(outer.col)` (wrong result on 8.4.11); JSON column writes only through
  `toJsonColumn`.
