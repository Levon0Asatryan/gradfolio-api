You are a worker chat on gradfolio-api, the backend API for Gradfolio: a student
portfolio platform (NPUA coursework) that serves the Next.js frontend from MySQL 8.4.
Repo: /Users/levon/Dev/university/gradfolio-repos/gradfolio-api
(GitHub Levon0Asatryan/gradfolio-api).

Read these first, in order:

1. CLAUDE.md
2. AGENTS.md
3. docs/tracker.md (M1 and the Decisions table)
4. docs/investigation.md (§3: facts about the schema that were verified by running
   them)

## Task

M1, the data layer: tasks 1.1–1.14 in docs/tracker.md.

Every later module reads and writes through what you build here: the migration
runner, the typed query layer, the shared validators, the test helpers and the seed.
Get the foundations right; nothing here is a user-facing feature.

## Scope

In:

- **Q2 (who owns the schema) and Q12 (the query layer): decide them in your plan,
  backed by evidence you ran.** The proposals are in the tracker's Decisions table.
  You may disagree, with evidence.
- 1.1 A migration runner.
  - `npm run migrate` and `npm run migrate:down`, with applied migrations recorded
    in a table.
  - **MySQL commits DDL implicitly**, so a transaction cannot make a migration
    atomic. So:
    - one DDL statement per step;
    - each step is recorded as soon as it succeeds;
    - DDL is guarded (`IF NOT EXISTS`, or an `information_schema` check) so a retry
      after a partial failure converges.
  - A new CI job applies the migrations, applies them again (must be a no-op), rolls
    them back, and applies them again.
- 1.2 A baseline migration equal to `../gradfolio-sql/sql/schema.sql` (11 tables).
  Prove they are identical (see Phase 3).
- 1.3 The query layer (per Q12), with row types:
  - snake_case in the database, camelCase in the API;
  - `TINYINT(1)` read as boolean;
  - JSON columns typed.
- 1.4 Ids are UUIDs generated in the app on every insert. Never rely on
  `DEFAULT (UUID())`, because `LAST_INSERT_ID()` is 0 for those tables.
- 1.5 Shared zod validators:
  - JSON array shapes: `string[]` and `{label, url}[]`;
  - `YYYY-MM` strings;
  - URL schemes: http and https only;
  - string lengths checked against the real column limits (utf8mb4 `VARCHAR(n)`
    counts characters).
- 1.6 A tag normalization rule: store tags in canonical case and match them
  case-insensitively. Also decide between a JSON column and a `project_technologies`
  table, and record why.
- 1.7 Schema migrations for the v1 features:
  - `projects.source` (manual or github) and `github_repo_id`;
  - repository `stars`, `forks` and `language`;
  - a draft/published flag for imported projects.
    The team-member re-invite rules wait for Q4 (M5) and are **out of scope** here.
- 1.8 CHECK constraints as defence in depth: `JSON_TYPE(col) = 'ARRAY'`, and a
  `YYYY-MM` pattern. Include the plan for existing rows.
- 1.9 Integration test helpers:
  - each test file gets a clean database (truncate, or a transaction per test);
  - factories for users, profiles and projects.
- 1.10 A dev/demo seed through the migration toolchain. Use realistic en/ru/am data,
  with notification links built from real ids (issue S12) and a consistent owner
  rule (S11).
- 1.11–1.14 gradfolio-sql fixes: S1 (the compose file crash-loops), S2/S13 (docs),
  S3–S6 (`queries.sql`), S11 (seed).
  - **You may open one PR in `../gradfolio-sql`** for these. This is an explicit
    exception to the template's no-other-repos rule.
  - Work in your own git worktree of that repo; never switch the main checkout's
    branch.
  - If Q2 makes the API the owner of the schema, the gradfolio-sql PR also turns
    its README into a pointer to the API's migrations.
- Compose runs migrations before the api starts (a `migrate` service), so
  `docker compose up -d --build` produces a real schema.

Out:

- Endpoints, and any user-facing feature (those start in M2).
- Decisions Q3–Q11, which belong to the modules that need them.
- The frontend repository.

## Starting point

- Branch from the latest origin/main.
- The #6 skeleton is merged: config, logging, errors, the `mysql2` pool pinned to a
  UTC session, health endpoints, OpenAPI, Docker and CI.
- Integration tests run against `docker compose up -d mysql` on host port 3307; the
  test database is `gradfolio_test`.
- `src/testing/` holds the helpers. Put new ones there.

## Known constraints and decisions already made

- Stack (Q1): NestJS 12, Node 24, TypeScript 6.0 (ESM, `nodenext`), zod, pino,
  mysql2, Vitest. TypeScript stays on 6.0.x.
- `npm run dev` uses `nest start` (tsc), because tsx drops decorator metadata.
- The facts in investigation §3.2 were run; do not re-argue them. D1–D9 cover:
  - UUID ids and `LAST_INSERT_ID`;
  - FULLTEXT and tokens shorter than 3 characters;
  - `JSON_CONTAINS` being case-sensitive;
  - no CHECK constraints;
  - `sql_mode` and the time zone;
  - the gradfolio-sql compose crash.
- `src/core` must not import from `src/api`; `src/architecture.test.ts` enforces it.
- The MySQL in compose and CI runs with `TZ=Asia/Yerevan` on purpose. Keep it.

## Deliverables

1. The plan PR: `docs/m1-plan.md`. **Stop and report after it opens.**
2. After approval, 2 or 3 implementation PRs in gradfolio-api. Suggested split:
   - (a) the migration runner, baseline, CI job and compose `migrate` service;
   - (b) the query layer, validators, tag rule, v1 schema additions, CHECKs, test
     helpers and seed.
3. One PR in gradfolio-sql (1.11–1.14).
4. `docs/m1-verification.md`, the final test record (see Phase 3).

## Phase 1: Investigation (before any plan or code)

Answer each of these with evidence. Claims about a library or MySQL are **run**, not
remembered, on MySQL 8.4 (`docker compose up -d mysql`) and on the versions you pin.

1. **Q12, the query layer.** Compare Kysely, Drizzle and Prisma (plus any other
   serious candidate) on this schema. For each, run and record:
   - an upsert on `users.auth0_id` that returns the row (MySQL has no `RETURNING`:
     how does each one read the row back, and is that race-safe?);
   - reading and writing JSON columns, with their types;
   - `TINYINT(1)` → boolean;
   - a transaction spanning several statements;
   - a raw `MATCH … AGAINST` query;
   - how row types are produced: generated from the database, or written by hand.
     Recommend one. Say what it costs you and what you give up.
2. **Q2, who owns the schema, and how migrations work.**
   - Either write our own small runner (as probeboard-api does), or adopt a tool;
     compare against the implicit-commit rule in 1.1.
   - Show a deliberately failing two-step migration and how each option recovers.
   - Decide what happens to gradfolio-sql, and how the seed and demo data flow.
3. **Baseline equivalence.** How will you prove that the baseline migration and
   `schema.sql` produce the same schema? `SHOW CREATE TABLE` for all 11 tables in two
   databases, normalized (AUTO_INCREMENT, ordering), then diffed. Show the command.
4. **Validators.** List every JSON and `YYYY-MM` column (investigation §3.2 D5) and
   the zod schema for each. Record what a utf8mb4 `VARCHAR(500)` actually accepts
   (characters, not bytes). Measure it.
5. **Tags.** Show how the stored case and the matching behave, with the evidence for
   your JSON-vs-table choice (tag cloud query, search query, index use via `EXPLAIN`).
6. **CHECK constraints.** Measure what MySQL 8.4 does when a CHECK is added to a
   table whose rows already violate it. Show how the seed and existing data pass.
7. **Test isolation.** Truncate per file or a transaction per test: measure the speed
   of each against the current suite shape, and pick one.
8. **Comparable systems and known bugs.** Known issues in the chosen library with
   MySQL 8.4 or `mysql2` 3.x (connection handling, JSON, time zones), and in the
   chosen migration approach. Each becomes a test or a decision.

List any contradictions between the tracker, the investigation and what you measured.

## Phase 2: Implementation

Follow the approved plan. Put any deviations in the report under "Decisions made".

- Every guard ships with a test that fails when the guard is removed: the migration
  record, the retry convergence, each validator, the tag normalization, each CHECK.
- Races are forced with a barrier, never a sleep.

## Phase 3: Revalidation, the final test

Record everything in `docs/m1-verification.md`: each command, what it printed, and
PASS or FAIL.

1. **Fresh clone** from the local repository:

   ```sh
   git clone <checkout> <dir> && git -C <dir> checkout <branch>
   ```

   then `npm ci`, `npm run build`, `npm run verify`, `npm run test:coverage` (floor
   90%) and `npm run test:int`.

2. **Empty database → full schema:**
   - `docker compose down -v` first.
   - `npm run migrate` on the empty database creates all tables and the v1
     additions.
   - Running `npm run migrate` again prints that there is nothing to apply.
   - `migrate:down` all the way, then `migrate`, brings the schema back identical.
3. **Baseline equivalence:** load `../gradfolio-sql/sql/schema.sql` into database A
   and the baseline migration only into database B. The normalized
   `SHOW CREATE TABLE` diff for all 11 tables is empty. Paste the diff command and its
   (empty) output.
4. **Partial-failure recovery:** a deliberately failing multi-step migration leaves
   the database in a state that the next `npm run migrate` completes. Show both runs.
5. **Seed:** it loads on the fresh schema. Record row counts per table, and query
   that every notification link resolves to a real row.
6. **CHECKs:** inserting `{"a":1}` into `projects.tags` and `banana` into
   `certifications.date` is rejected by MySQL. Paste the error codes.
7. **Real run:** on an empty volume, `docker compose up -d --build`. The `migrate`
   service runs first, the api reports `/readyz` ok, and the schema is present.
   Tear down with `docker compose down -v`.
8. **gradfolio-sql PR:** on a fresh volume, its `docker compose up -d` reaches
   healthy (issue S1 fixed). Show `docker compose ps` and the entrypoint log lines.
9. **Plan walk:** point every "must" in `docs/m1-plan.md` at the line that implements
   it, and list any gap.
10. **Guard proofs:** a table with columns | guard removed | test that failed |.
11. **CI:** every job is green on the head commit of each PR, including the new
    migrations job.
12. **Machine clean:** list the containers and volumes you started and confirm each
    is removed.

## Phase 4: Re-review

- Phase 3 finishes before the first push of code. Push a PR you would merge.
- Run /gradfolio-review. It writes the receipt that the pre-push gate requires. If
  the skill is not loaded in your session, run its passes by hand and write the
  receipt with an honest `method`.
- **Two reviewers on every push: GitHub Copilot and Codex.** Request both with
  `sh scripts/request-review.sh [pr] ["scope"]` (after #10 merges; before that:
  `gh pr edit <n> --add-reviewer @copilot` and a PR comment `@codex review`).
- A push counts as reviewed only when both have reviewed the head commit
  (`sh scripts/review-status.sh <n>` exits 0). Findings from both on one push are
  one round.
  - Check each finding's premise before acting on it; push back with evidence when it
    is wrong.
  - Two rounds, then fix-now findings only. The last fix push gets one confirmation
    round on the head commit, limited to the new commits.
  - One push per round. Every fix push re-runs the full gate and a check of what the
    fix could have broken. Resolve each thread once its fix is verified.

## Stop points

- After opening the plan PR (`docs/m1-plan.md`): stop and report. Levon approves it.
- Do not merge. Do not push to main.
- Do not edit docs/tracker.md. Propose changes in your report.

## When to report, and when not to

Send one report per pull request, when it is finished: pushed, CI green, both
reviewers' rounds done (Copilot and Codex on the head commit), threads resolved, machine clean. Do not report per push, per
review round or per fix.

Report mid-flight only in these cases, and immediately:

1. You are blocked, you have diagnosed the cause, and clearing it needs a decision
   that is not yours.
2. Something invalidates the plan's design.
3. You find a defect in work that is already merged.
4. You need something outside the two checkouts this prompt allows.

Handle review rounds, deviations from the plan's wording, tests breaking while you
fix findings, and misbehaving tooling yourself. Put them in the report.

Send reports to the orchestrator session gradfolio-repos-08 with SendMessage, in the
format from docs/handoff-template.md, part 2. Include a "Changes needed in other
repos" line for anything that goes beyond the gradfolio-sql PR.
