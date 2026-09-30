# M1 verification

The final test record for M1 (tracker 1.1–1.14, `docs/m1-plan.md`), run on
2026-09-29 against MySQL 8.4.11.

- Every database run below starts from an **empty volume** (`docker compose down -v`
  first), so no earlier rows can leak into the numbers.
- Local runs use the standalone `docker-compose` v5.5.0 binary: this machine's
  sandbox does not discover the `docker compose` plugin (same binary). CI uses
  `docker compose`.

Pull requests: gradfolio-api #9 (plan), #11 (runner, baseline), #12 (query layer and
the rest); gradfolio-sql #1.

| #   | Check                            | Result  |
| --- | -------------------------------- | ------- |
| 1   | Fresh clone: build and full gate | PASS    |
| 2   | Empty database → full schema     | PASS    |
| 3   | Baseline equivalence             | PASS    |
| 4   | Partial-failure recovery         | PASS    |
| 5   | Seed                             | PASS    |
| 6   | CHECKs                           | PASS    |
| 7   | Real run (`docker compose up`)   | PASS    |
| 8   | gradfolio-sql compose (S1)       | PASS    |
| 9   | Plan walk                        | PASS    |
| 10  | Guard proofs                     | PASS    |
| 11  | CI on each PR's head commit      | see §11 |
| 12  | Machine clean                    | PASS    |

## 1. Fresh clone

```sh
git clone /Users/levon/Dev/university/gradfolio-repos/gradfolio-api <dir>
git -C <dir> checkout m1/data-layer          # HEAD df63f77
npm ci && npm run build && npm run verify && npm run test:coverage && npm run test:int
```

| Command                 | Printed                                                                                             | Result |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| `npm run build`         | `dist/core/db/migrations/`: `0001`–`0004` `.up.sql` and `.down.sql`                                 | PASS   |
| `npm run verify`        | Prettier clean, lint clean, types clean, `openapi.yaml: up to date`, 22 files, **260 tests passed** | PASS   |
| `npm run test:coverage` | 260 passed; statements 99.12%, branches 96.98%, functions 98.85%, lines 99.66% (floor 90%)          | PASS   |
| `npm run test:int`      | 14 files, **65 tests passed** (67 after review round 1 added two unique-key tests)                  | PASS   |

Each commit on its own (`git checkout <c>`, `tsc --noEmit`, `vitest run`):

```
194355b types ok  127 passed    498da32 types ok  169 passed
92da6c0 types ok  169 passed    c13aa49 types ok  240 passed
d2510f7 types ok  169 passed    1f41069 types ok  253 passed
1bf6130 types ok  169 passed    1728e86 types ok  260 passed
                                df63f77 types ok  260 passed
```

## 2. Empty database → full schema

```
$ docker compose down -v && docker compose up -d mysql
$ mysql -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='gradfolio'"
0
$ npm run migrate
migrations: applied 0001_baseline (11 steps)
migrations: applied 0002_value_checks (5 steps)
migrations: applied 0003_project_terms (16 steps)
migrations: applied 0004_project_source (1 steps)
$ (tables)
activities certifications education experience integrations notifications project_attachments
project_tags project_team_members project_technologies projects schema_migrations terms user_skills users
$ (projects columns among source, is_draft, github_repo_id, repo_stars, repo_forks, repo_language, tags, technologies)
github_repo_id is_draft repo_forks repo_language repo_stars source        -- v1 additions present; tags/technologies moved out
$ (check constraints)
9
$ npm run migrate
migrations: nothing to apply
$ npm run db:schema > first.sql
$ npm run migrate:down -- --all
migrations: rolled back 0004_project_source
migrations: rolled back 0003_project_terms
migrations: rolled back 0002_value_checks
migrations: rolled back 0001_baseline
$ (tables; registry rows)
schema_migrations
0
$ npm run migrate          # the same four lines as above
$ npm run db:schema > second.sql && diff first.sql second.sql && echo 'diff: empty (identical)'
diff: empty (identical)
```

**PASS**

## 3. Baseline equivalence

Database A gets gradfolio-sql's `schema.sql` (commit 187ff66) through the `mysql` CLI.
Database B gets only `0001_baseline` through the runner. The dump is the normalized
`SHOW CREATE TABLE` of every base table except `schema_migrations`, sorted, with
`AUTO_INCREMENT=n` removed (`src/core/db/migrator/schema-dump.ts`).

```
$ git -C ../gradfolio-sql show 187ff66:sql/schema.sql | sed -e '/^CREATE DATABASE/,/;/d' -e '/^USE /d' | mysql eq_a
$ DATABASE_URL=mysql://root:root@127.0.0.1:3307/eq_b npm run migrate -- --to 0001_baseline
migrations: applied 0001_baseline (11 steps)
$ DATABASE_URL=…/eq_a npm run db:schema > eq_a.sql && DATABASE_URL=…/eq_b npm run db:schema > eq_b.sql
$ grep -c '^CREATE TABLE' eq_a.sql eq_b.sql
eq_a.sql:11
eq_b.sql:11
$ diff eq_a.sql eq_b.sql; echo "diff exit $?"
diff exit 0
```

The diff output is empty. The same comparison runs on every integration run
(`baseline.int.test.ts`, against the committed fixture). The CI `migrations` job
checks that fixture is byte-identical to gradfolio-sql@187ff66 on GitHub.

Negative control (guard proof, §10): with `INDEX idx_projects_status` dropped from the
baseline, the test fails and its diff shows `-   KEY idx_projects_status (status),`.

**PASS**

## 4. Partial-failure recovery

A two-step migration whose step 2 names a table that does not exist:

```
$ cat src/core/db/migrations/0005_verify_demo.up.sql
CREATE TABLE IF NOT EXISTS verify_demo (id INT PRIMARY KEY);
-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'verify_demo' AND column_name = 'note'
ALTER TABLE does_not_exist ADD COLUMN note VARCHAR(50);
$ npm run migrate
migrations: 0005_verify_demo (up) step 2 failed: ER_NO_SUCH_TABLE: Table 'gradfolio.does_not_exist' doesn't exist (…)
$ (registry; tables)
0005_verify_demo  up  1
verify_demo
```

Step 1 committed (DDL commits implicitly) and was recorded. The author fixes step 2
(`ALTER TABLE verify_demo …`):

```
$ npm run migrate
migrations: applied 0005_verify_demo (resumed at step 2 of 2)
$ (registry; columns)
0005_verify_demo  up  1
0005_verify_demo  up  2
id    int          NO  PRI
note  varchar(50)  YES
$ npm run migrate:down
migrations: rolled back 0005_verify_demo
```

The failing run exits **1**:
`node dist/core/db/migrator/cli.js up` → `migrations: 0005_x (up) step 2 failed: …`, `[exit 1]`.
The demo migration was then removed, and `npm run migrate` printed
`migrations: nothing to apply`.

**PASS**

## 5. Seed

On the schema from §2:

```
$ npm run db:seed
seed: loaded
```

| Table                | Rows |
| -------------------- | ---- |
| users                | 6    |
| education            | 5    |
| experience           | 3    |
| certifications       | 3    |
| user_skills          | 23   |
| terms                | 39   |
| projects             | 8    |
| project_technologies | 23   |
| project_tags         | 14   |
| project_attachments  | 4    |
| project_team_members | 6    |
| integrations         | 2    |
| activities           | 5    |
| notifications        | 4    |

```
$ SELECT n.link, (n.link = CONCAT('/projects/', p.id)) AS resolves FROM notifications n LEFT JOIN projects p ON p.id = n.reference_id
/projects/b2000000-0000-4000-8000-000000000001  1
/projects/b2000000-0000-4000-8000-000000000001  1
/projects/b2000000-0000-4000-8000-000000000002  1
/projects/b2000000-0000-4000-8000-000000000003  1
$ SELECT COUNT(*) FROM project_team_members m JOIN projects p ON p.id = m.project_id WHERE m.user_id = p.user_id
0
$ npm run db:seed; SELECT COUNT(*) FROM users
seed: loaded
6
```

- Every notification link resolves to a real project: 4 of 4 (S12).
- No owner is a team member of their own project (S11).
- A second load gives the same rows.

**PASS**

## 6. CHECKs

```
$ INSERT INTO certifications (…, date) VALUES (…, 'banana')
ERROR 3819 (HY000): Check constraint 'ck_certifications_date' is violated.
$ INSERT INTO projects (…, links) VALUES (…, '{"a":1}')
ERROR 3819 (HY000): Check constraint 'ck_projects_links' is violated.
```

`projects.tags` became the `project_tags` table in 0003, so the plan's literal case
was run on a database migrated to 0002, where the column still exists:

```
$ DATABASE_URL=…/chk_0002 npm run migrate -- --to 0002_value_checks
$ INSERT INTO projects (…, tags) VALUES (…, '{"a":1}')
ERROR 3819 (HY000): Check constraint 'ck_projects_tags' is violated.
```

`checks.int.test.ts` covers every constraint: 12 bad values, each rejected with 3819
through the real driver.

**PASS**

## 7. Real run

Host port 3000 was held by another project's container (probeboard API) on this
machine, so the api was published on 3001 (`API_HOST_PORT=3001`, which the compose file
supports). A first attempt on 3000 answered `/readyz` from **that** container: its
`/docs-json` title was "probeboard API". That result is discarded. The run below
checks the title.

```
$ docker compose down -v && API_HOST_PORT=3001 docker compose up -d --build
 Container gradfolio-api-mysql-1 Healthy
 Container gradfolio-api-migrate-1 Exited
 Container gradfolio-api-api-1 Started
api container health: healthy after 6s
$ docker compose ps -a
api       running   Up 5 seconds (healthy)     0.0.0.0:3001->3000/tcp
migrate   exited    Exited (0) 5 seconds ago
mysql     running   Up 11 seconds (healthy)    0.0.0.0:3307->3306/tcp
$ docker compose logs migrate
migrations: applied 0001_baseline (11 steps)
migrations: applied 0002_value_checks (5 steps)
migrations: applied 0003_project_terms (16 steps)
migrations: applied 0004_project_source (1 steps)
$ curl localhost:3001/healthz; curl localhost:3001/readyz; curl localhost:3001/docs-json | grep title
{"status":"ok"}
{"status":"ok","database":"ok"}
"title":"Gradfolio API"
$ (tables other than the registry; registry per migration)
14
0001_baseline 11 · 0002_value_checks 5 · 0003_project_terms 16 · 0004_project_source 1
$ docker compose run --rm migrate
migrations: nothing to apply
$ docker compose run --rm migrate node dist/core/db/seed/cli.js
seed: loaded
$ docker compose down -v
```

**PASS**

## 8. gradfolio-sql PR #1: compose on a fresh volume (S1)

At its head d1907e7:

```
$ docker compose down -v && docker compose up -d
 Container gradfolio-mysql Healthy
 Container gradfolio-adminer Started
$ docker compose ps
gradfolio-adminer   running   Up Less than a second
gradfolio-mysql     running   Up 5 seconds (healthy)
RestartCount: 0
$ docker logs gradfolio-mysql | grep -E "initdb.d|ERROR|ready for connections"
[Entrypoint]: running /docker-entrypoint-initdb.d/01-schema.sql
[Entrypoint]: running /docker-entrypoint-initdb.d/02-seed.sql
mysqld: ready for connections. Version: '8.4.11' … port: 3306
$ (users, projects, team members, notifications)
3  4  3  3
$ docker compose down -v
```

Before the fix, the entrypoint ran `drop.sql` and `queries.sql` first and stopped with
`ERROR 1146` (investigation D9).

**PASS**

## 9. Plan walk

Every requirement sentence in `docs/m1-plan.md`, and the line that implements it.

| Plan                                                                                   | Implemented at                                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| §3.3 one statement per step, split on `;` at end of line                               | `src/core/db/migrator/files.ts:17` (`END`), `parseSteps`                                   |
| §3.3 `-- skip-if:` guard; a row means "already in effect"                              | `files.ts:14` (`GUARD`); `runner.ts` `alreadyInEffect`                                     |
| §3.3 every step must be re-runnable (unit test over all files)                         | `files.ts:114` `isRerunnable`; `files.test.ts:97`                                          |
| §3.3 registry `(name, direction, step, checksum, applied_at)`                          | `registry.ts:25`                                                                           |
| §3.3 `GET_LOCK`, timeout from `MIGRATION_LOCK_TIMEOUT_S`                               | `runner.ts:211`; `config/schema.ts:85`                                                     |
| §3.3 refuse a database ahead of the build                                              | `runner.ts:155`                                                                            |
| §3.3 refuse an edited applied step (checksum)                                          | `runner.ts:170`                                                                            |
| §3.3 refuse `up` while partially rolled back                                           | `runner.ts:50`                                                                             |
| §3.3 record each step immediately after it succeeds                                    | `runner.ts:184` (`recordStep` right after the statement)                                   |
| §3.3 `nothing to apply`, exit 0; failure names migration, step, error; exit 1          | `runner.ts:66`; `cli.ts` `main().catch` → `exit(1)` (§4)                                   |
| §3.3 down: record down steps, delete the migration's rows at the end                   | `runner.ts:107` (`forget`)                                                                 |
| §3.3 one connection, same `poolOptions`                                                | `cli.ts:22`                                                                                |
| §3.3 SQL copied into `dist`                                                            | `nest-cli.json:9`                                                                          |
| §3.4 0001 = schema.sql                                                                 | `0001_baseline.up.sql`; proof §3                                                           |
| §3.4/§7 0002 CHECKs with `JSON_SCHEMA_VALID` and `REGEXP_LIKE`                         | `0002_value_checks.up.sql:29,48,58,67`                                                     |
| §7 audit query for existing rows                                                       | `0002_value_checks.up.sql:11`; `0003_project_terms.up.sql` header                          |
| §6.2 `terms` registry, case-insensitive key                                            | `0003_project_terms.up.sql:27`                                                             |
| §6.2 legacy values normalized before registration (`SQL_NORMALIZE`)                    | `0003_project_terms.up.sql:52,61,68`; agreement test in `terms.int.test.ts`                |
| §6.1 over-long legacy name fails rather than vanishing                                 | `0003_project_terms.up.sql:61,68` (`TEXT … ERROR ON ERROR`)                                |
| §7 duplicate skills merged before UNIQUE                                               | `0003_project_terms.up.sql:98`, then `:107`                                                |
| §3.4 0003 drops `tags`/`technologies` after 0002 proved them                           | `0003_project_terms.up.sql:104`                                                            |
| §3.4 0003 down restores ordered JSON (`GROUP_CONCAT … ORDER BY`, `SET_VAR`)            | `0003_project_terms.down.sql`                                                              |
| §3.6 `source`, `is_draft`, `github_repo_id`, stars, forks, language, UNIQUE            | `0004_project_source.up.sql:12,18`                                                         |
| §2.3 TINYINT(1) → boolean                                                              | `pool.ts:52` (`castTinyIntBoolean`)                                                        |
| §2.3 `dateStrings: ['DATE']`                                                           | `pool.ts:56`                                                                               |
| §2.3 `maintainNestedObjectKeys: true`                                                  | `database.ts:23`                                                                           |
| §2.3 the callback pool (`pool.pool`)                                                   | `database.ts:23`                                                                           |
| §2.3 JSON only through `toJsonColumn`, branded                                         | `json.ts:12`; `column-types.ts:20`                                                         |
| §2.3 row types generated with overrides; `--verify` in CI                              | `.kysely-codegenrc.json:17`; `ci.yml:144`                                                  |
| 1.4 ids generated in the app; required by the types                                    | `ids.ts:8`; `.kysely-codegenrc.json` (`*.id: string`); type test in `database.int.test.ts` |
| MySQL error mapping against real errors                                                | `mysql-errors.ts:6`; `mysql-errors.int.test.ts`                                            |
| `inTransaction` retries 1213                                                           | `transaction.ts:19`                                                                        |
| §5.1 VARCHAR counts code points, TEXT bytes                                            | `validation/text.ts:19` (`measure`)                                                        |
| §5.1 `COLUMN_LIMITS` checked against `information_schema`                              | `validation/columns.ts:9`; `columns.int.test.ts`                                           |
| §5.2 `stringList`, `linkList`, `translationParams`, `yearMonth`, `httpUrl`, `termList` | `json-shapes.ts:23,28,42`; `year-month.ts:7`; `http-url.ts:4`; `terms.ts:35`               |
| §6.2 canonical spelling: ODKU then `FOR SHARE`; fixed lock order                       | `db/terms.ts:20,25,40`                                                                     |
| §8 every file starts clean (DELETE, automatic)                                         | `testing/database.ts:96`; `vitest.integration.mts:17`                                      |
| §8 global setup migrates the test database                                             | `testing/global-setup.ts:10`                                                               |
| §8 admin URL, scratch databases, barrier                                               | `testing/database.ts:30,45`; `testing/barrier.ts:12`                                       |
| §8 factories: users, profiles, projects (with technologies, tags, attachments)         | `testing/factories.ts:19,37,94`                                                            |
| §9 seed refuses production and pending migrations                                      | `seed/cli.ts:20,29`                                                                        |
| §9 one transaction, deletes only its own users first                                   | `seed/seed.ts:23`                                                                          |
| §9 links from real ids; owner never a member                                           | `seed/seed.ts:135`; `seed/seed.test.ts:73`                                                 |
| §9 a GitHub draft, a private project, a private profile, en/ru/am                      | `seed/data.ts:30` and the `projects` and `users` lists                                     |
| §10 compose `migrate` service before the api                                           | `docker-compose.yml:33,73`                                                                 |
| §10 CI migrations job: apply, no-op, down all, re-apply, diff, fixture, types, seed    | `ci.yml:87`–`:156`                                                                         |
| §12 CLAUDE.md facts and commands; AGENTS.md stack line                                 | `CLAUDE.md` "Facts every chat must know"; `AGENTS.md:11`                                   |

**Deviations** (the plan's wording versus the code; none changes the design):

- **Baseline proof.** Plan §4 has CI fetch `schema.sql` and diff it. Instead, the upstream
  file is a committed fixture diffed by `baseline.int.test.ts` on every run, and CI checks
  the fixture against gradfolio-sql@187ff66.
- **Term tables' collation.** Plan §6.2's comment says `utf8mb4_unicode_ci`. The tables
  take the database default, like the baseline tables they join with. Locally and in CI
  that is `utf8mb4_unicode_ci`. A mismatched explicit collation on Aiven would make the
  joins fail with 1267 ("illegal mix"). M9: check Aiven's default collation.
- **`canonicalizeTerms`** takes locks in one sorted order, a detail the plan did not
  specify. It prevents lock-order inversion between two writers of the same names.

Gaps: none found.

## 10. Guard proofs

Each guard was removed on the final code and the named test run. Every one failed.
Migration mutations ran against a throwaway test database, so the checksum guard on
`gradfolio_test` would not mask them.

| Guard removed                                                                                               | Test that failed                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| record each step as it succeeds (record only at the end)                                                    | `records a step the moment it succeeds, so a failed migration resumes where it stopped`                                                    |
| a DML step and its record in one transaction (#9 P1 follow-up; DML forced down the untransacted path)       | `a DML step leaves neither the change nor the record when recording fails after the statement`: the blank skill was deleted with no record |
| DML classifier accepts only plain INSERT/UPDATE/DELETE/REPLACE (#9 P1 follow-up; regex widened to anything) | `files.test.ts`: `treats "CREATE TABLE …" / "ALTER TABLE …" / … as DDL`                                                                    |
| `skip-if` evaluation                                                                                        | `closes the crash window: a step in effect but unrecorded is recorded, not re-run`                                                         |
| checksum check                                                                                              | `refuses when an applied step has been edited`                                                                                             |
| database-ahead check                                                                                        | `refuses a database that records a migration this build does not have`                                                                     |
| `GET_LOCK`                                                                                                  | `refuses to run while another runner holds the lock on this database`                                                                      |
| lock release in `finally`                                                                                   | `releases the lock after a failed run`                                                                                                     |
| refuse `up` while partially rolled back                                                                     | `resumes a rollback that failed part-way, and refuses to migrate up meanwhile`                                                             |
| down skips recorded down steps                                                                              | same test                                                                                                                                  |
| `isRerunnable` lint                                                                                         | `files.test.ts`: 5 × `rejects … without a guard`                                                                                           |
| baseline = schema.sql (one index dropped)                                                                   | `0001_baseline is identical to gradfolio-sql schema.sql` (diff shows the index)                                                            |
| TINYINT(1) `typeCast`                                                                                       | `reads TINYINT(1) as boolean and maps snake_case columns to camelCase`                                                                     |
| `dateStrings: ['DATE']`                                                                                     | `reads DATE as YYYY-MM-DD and DATETIME as a Date`                                                                                          |
| `maintainNestedObjectKeys`                                                                                  | `keeps the keys inside JSON values as stored, snake_case included`                                                                         |
| callback pool (`pool.pool` → the promise pool)                                                              | `database.int.test.ts` fails: `Hook timed out` (queries hang)                                                                              |
| `inTransaction` retry on 1213                                                                               | `retries the deadlock victim, and both callers get the one row`                                                                            |
| `FOR SHARE` in `canonicalizeTerms`                                                                          | `give two concurrent first writers one spelling (barrier)`                                                                                 |
| `terms` registry lookup                                                                                     | `store the canonical spelling and match case-insensitively`                                                                                |
| `toJsonColumn` validation                                                                                   | `refuses a value of the wrong shape…`, `serializes what the schema returned, normalized`                                                   |
| 0003 legacy normalization                                                                                   | `normalizes legacy spellings, so one term has one key and one spelling`                                                                    |
| 0003 duplicate-skill merge                                                                                  | `merges case-insensitive duplicate skills, keeping the first, before the UNIQUE key`                                                       |
| 0003 `TEXT … ERROR ON ERROR` (→ `VARCHAR(255)`, the default)                                                | `stops, losing nothing, when a legacy name is longer than the new column`                                                                  |
| CHECK `ck_certifications_date`                                                                              | `rejects certifications.date = banana with 3819`                                                                                           |
| CHECK links element shape (`required: [label, url]`)                                                        | `rejects projects.links = [{"label":"a"}] with 3819`                                                                                       |
| VARCHAR counted in code points                                                                              | `VARCHAR(500): 500 emoji -> true` (and one more)                                                                                           |
| http/https scheme check                                                                                     | `rejects "javascript:alert(1)"` (4 failed)                                                                                                 |
| `YYYY-MM` month range                                                                                       | `rejects "2024-13"`, `rejects "2024-00"`                                                                                                   |
| `linkList` strict object                                                                                    | `rejects an extra key`                                                                                                                     |
| `COLUMN_LIMITS` = real limits (`users.headline` 500 → 400)                                                  | `matches every string column of the migrated schema`                                                                                       |
| seed deletes its own rows first                                                                             | `loads on the migrated schema, and loading again gives the same rows`                                                                      |
| seed links from real ids (→ `/projects/proj_001`)                                                           | `builds every notification link from a real project id (S12)`                                                                              |
| per-file reset (`setupFiles` removed)                                                                       | `starts every file with empty tables, whatever was left before it`                                                                         |
| ids required by the row types (`id: Generated<string>`)                                                     | `tsc`: `database.int.test.ts` `Unused '@ts-expect-error' directive` (insert without id now compiles)                                       |
| JSON columns accept `JsonText` only (→ `string`)                                                            | `tsc`: `database.int.test.ts` `Unused '@ts-expect-error' directive` (`JSON.stringify` now compiles)                                        |
| UNIQUE `(user_id, skill_name)` (0003); review round 1                                                       | `user_skills: one skill per user, case-insensitively (0003)`                                                                               |
| UNIQUE `(user_id, github_repo_id)` (0004); review round 1                                                   | `projects: one import of a GitHub repository per user (0004)`                                                                              |
| seed reload writes the same content (roles changed per load); review round 1                                | `loads on the migrated schema, and loading again gives the same rows`; counts alone had passed                                             |
| queries.sql 8a (gradfolio-sql): NULL teammate                                                               | checked by hand on 8.4.11: external 1 row, account 1, owner self 0, non-owner 0                                                            |
| queries.sql visibility on 1b-1g and 2d (gradfolio-sql, round 2)                                             | checked by hand on 8.4.11, private profile and project: non-owner 0 rows, owner 1+                                                         |

Not proven by a test: the sorted lock order in `canonicalizeTerms`. A test would need
two writers taking the same two new names in opposite orders, and with the sort they
cannot, so no interleaving can show the difference. The code comment records why it is
there.

## 11. CI

| PR                | Head                 | Jobs                                                                                                                                 |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| gradfolio-api #11 | `1bf6130`            | static, unit, integration, **migrations**, stack: all pass (merged)                                                                  |
| gradfolio-api #12 | `7932634`, `5281ff1` | static, unit, integration, migrations, stack: all pass on both heads. Review: Codex round 1 (3 findings, fixed), round 2 no findings |
| gradfolio-sql #1  | `69991dc`            | no CI in that repository; §8 re-run is unaffected (the fixes touch only `queries.sql`, which compose does not mount)                 |

## 12. Machine clean

Containers and volumes this milestone started, and their state at the end:

| Started                                                                                                       | Removed                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `gradfolio-api-mysql-1` + volume `gradfolio-api_mysqldata`                                                    | yes (`docker compose down -v`) |
| `gradfolio-api-migrate-1`, `gradfolio-api-api-1` (real runs)                                                  | yes                            |
| `gradfolio-mysql`, `gradfolio-adminer` + volume `gradfolio_mysql_data` (gradfolio-sql)                        | yes                            |
| scratch databases inside the compose MySQL (`gradfolio_scratch_*`, `mut_test`, `eq_a`, `eq_b`, `chk_0002`, …) | gone with the volume           |
| the probeboard containers on this machine                                                                     | not ours; left untouched       |

Scratch clones and logs live in the session scratchpad, outside every repository.
