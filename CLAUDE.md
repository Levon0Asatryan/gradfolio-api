# gradfolio-api — working conventions

Read this before adding files. `AGENTS.md` has the review rules: what to flag on a
pull request. This file has the conventions to follow while writing.

## How work is done

Work is split across chats:

- one **orchestrator** session tracks the project and checks the work;
- **worker** chats each implement one milestone, or one step of a plan, from a
  handoff prompt (`docs/handoff-template.md`).

`docs/tracker.md` is the status of record, so read it first. Levon approves plans and
merges pull requests. No chat merges.

### Cost discipline: keep the review loop cheap

- **Two review rounds per PR, then stop.** In rounds one and two, fix whatever is
  real. After that, each finding is either **fix-now** or a tracker follow-up.
  - Fix-now means only a security hole, data loss, a wrong result, or a broken build.
  - Everything else gets a one-line reply saying it is deferred, plus a follow-up
    row in the tracker.
  - Answer every thread either way.
- **The cap limits what gets fixed, not whether the latest commit gets reviewed.**
  - After the last fix push, ask explicitly for one confirmation round on the head
    commit, limited to the commits since the previous round.
  - In that round, act only on fix-now findings. Everything else becomes a follow-up
    row, so the round cannot restart the loop.
  - Without it, a PR merges with its newest (and often subtlest) commits seen by
    nobody except their author.
- **Push back on a wrong finding with evidence instead of implementing it.**
  - Check the premise first. A review that cites a limit, a default or a standard is
    stating a fact, and facts can be checked.
  - If the suggested fix would turn a bounded problem into a silent failure, that is
    the more expensive defect: say so and defer.
- **Build for this project's real scale.** Gradfolio is university coursework: tens
  of users, hundreds of projects, a free-tier database.
  - Work that only pays off at a larger scale is out of scope by default. Say so in
    the plan and move on.
  - Correctness, security, and the evidence for both still apply.
- **Two or three PRs per milestone**, not five to seven: one plan PR, then the
  implementation in coherent chunks.

### The review loop

1. **The first push is a finished PR, not a draft.** Phase 3 (the full test suite,
   removing each guard to prove its test fails, and a real run) happens **before**
   the first push of code. If the reviewers see work the author hasn't checked, the
   author's own defects become review rounds.
2. **One push per round, carrying every finding from that round.** Read all the
   comments, decide on all of them, fix all of them, then push once.
3. **Every fix push re-runs the full automated gate and checks what the fix could
   have broken.** Review fixes break other things. Before pushing a fix:
   - run the verify step and the full unit and integration suites;
   - repeat the real run if the fix touched an HTTP endpoint, a migration, the
     database or concurrency;
   - re-read the fix against what it could affect: re-prove each guard it touches by
     removing it, and check the callers of anything whose signature, timing or error
     behaviour changed.
4. **A plan PR gets one review round, then it merges.** Review cannot make a design
   document correct: it has no tests, and each fix opens new surface. Fix only what
   changes the design.
5. **Resolve a thread once its fix is pushed and verified.** Reply with what changed
   and in which commit, then resolve. A thread stays open only for:
   - pushback that is waiting on Levon, or
   - a deferral that has a tracker row.

### Every task runs four phases (not optional)

1. **Investigation**, before any plan or code.
   - Cover the requirements in scope, the code on `main` that the work touches, how
     comparable systems solve the problem, and published vulnerabilities and bug
     reports in the area. Each finding becomes a test or a decision.
   - Claims about how a library or runtime behaves are **run**, not remembered, and
     run against the version the project actually pins.
2. **Implementation**, only after the plan is approved.
3. **Revalidation.**
   - Walk the plan against the code and close every gap.
   - Re-prove every guard by removing it, on the final code.
   - Do a fresh clone and a real run for anything that touches an HTTP endpoint, a
     migration or the database, and for the last PR of a milestone. The clone runs
     install, build, verify and integration tests (commands in "Commands" below).
   - Clone from the local repository
     (`git clone <checkout> <dir> && git -C <dir> checkout <branch>`), never by pushing
     first to have something to clone: a push is where the review gate runs.
4. **Re-review.**
   - Read the whole diff as a hostile reviewer, against `AGENTS.md`.
   - Separately, **walk the plan's requirement sentences** (every "must", "is anchored
     on", "is excluded from") and point to the line that implements each one.
   - Reading a diff for smells finds lifetime bugs. It does not find code that
     departs from a sentence already written in the plan.

### Before writing code

- Plan first, in `docs/mN-plan.md`: investigation, decisions, data model, endpoints,
  security properties and how each is proved, and the PR breakdown.
- Check that `git config user.email` is the email of the developer whose chat this
  is (for Levon, `levonasatryan1098@gmail.com`).
- Branch from the latest `origin/main`, then install dependencies.
- One chat per working tree at a time: two chats in one checkout corrupt each
  other's work.

### While writing

- Never push to `main`. One PR per coherent step.
- **Check the branch is still live before committing to it.**
  - A branch whose PR is merged or closed is dead, and commits on it are stranded.
  - `scripts/check-branch.sh` enforces this on push.
  - After a merge, fetch and cut a new branch before writing anything else.
- **Split commits by logical change, never one commit for a whole PR.**
  - Tests go in the same commit as the code they test.
  - Each commit passes the pre-commit hook on its own.
  - Review fixes are separate commits, named after the finding.
- **Prove every guard, and every new test, by removing what it tests** and watching
  it fail. A test that has never been seen failing is not evidence: tests can pass
  for the wrong reason when the assertion can be satisfied another way.
- **Force races with a barrier, never a sleep.** Commit the competing write on a
  second connection, or poll until the other connection is blocked. A race test built
  on sleeps passes on a fast machine whether or not the guard exists.
- **A table that maps external signals is untested until one real example of each
  class has come through the real transport.** On the project this kit comes from,
  hand-built error objects passed the tests while real ones did not. Here that means
  Auth0 and GitHub responses, and MySQL error codes.
- **Diagnose an environment failure to its cause before reporting it as blocking.**
  Example: on this machine, Docker Desktop listens on
  `unix://$HOME/.docker/run/docker.sock`, and the CLI only finds it once
  `DOCKER_HOST` is set.

### Before calling it done

1. The full gate: verify, coverage (at or above the project threshold) and
   integration tests.
2. A **real run**: start the system for real, exercise every changed endpoint, and
   check what was stored. Passing tests alone is not done.
3. CI is green on every job, and `gh pr view <n> --json mergeable` says `MERGEABLE`.
   Green checks do not mean there are no conflicts.
4. **Both reviewers review every push: GitHub Copilot and Codex.**
   - Request both on every push, including the confirmation round and docs-only PRs
     (docs-only PRs do not wait for them before merging):
     `sh scripts/request-review.sh [pr] ["scope note"]`.
     - Copilot is requested as a formal reviewer.
     - Codex is asked through an `@codex review` comment, because it is a GitHub App
       and the review-request API does not accept it.
   - Read the findings from both with
     `gh api repos/Levon0Asatryan/gradfolio-api/pulls/<n>/comments --paginate`.
   - A push counts as reviewed only when **both** have reviewed the head commit.
     `sh scripts/review-status.sh [pr]` checks this and exits 0 only when both have.
     - A reviewer has reviewed the head when `pulls/<n>/reviews` has an entry of theirs
       whose `commit_id` is the head.
     - For Codex, a no-findings 👍 timestamped after the head was pushed also counts.
       A 👀 from Codex means it is still reviewing.
   - Findings from both reviewers on the same push belong to **one** round: decide all
     of them, then push once.
5. **Leave the machine clean.**
   - Stop everything a run started, and check for one-off containers or processes the
     task created.
   - Use `--rm` on throwaway `docker run`s, and remove scratch files.
   - An evidence run starts from an empty database volume so old rows cannot leak
     into its numbers. Say so in the report.
6. At the end of a milestone, write `docs/mN-verification.md`: what was run and what
   it produced, including defects found by running it.
7. Report in the format in `docs/handoff-template.md`. Say plainly what was not
   verified.

Style: laconic. Same facts, fewer words.

---

## The project

**Gradfolio** is a student portfolio platform, built as NPUA university coursework.
This repository is its backend API.

### The workspace

Absolute path: `/Users/levon/Dev/university/gradfolio-repos`.

| Path             | What it is                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `gradfolio-api/` | This repo.                                                                                                                                |
| `gradfolio/`     | Frontend: Next.js 16, MUI 7, Auth0 v4, on Vercel. All data is currently mock.                                                             |
| `gradfolio-sql/` | MySQL 8.4 schema (11 tables), seed data, example queries, per-table docs.                                                                 |
| `docs/`          | The product spec (`Student Portfolio Management System – Feature Specification.md`) and a competitor analysis. These are not in any repo. |
| `issues.md`      | Known defects across all three repos.                                                                                                     |

Background for every milestone:
[`docs/investigation.md`](docs/investigation.md), covering the schema facts verified
by running them, the gaps between frontend and schema, and open decisions Q1–Q10.

### Stack

Decided: **NestJS 12 on Node 24, TypeScript 6.0 (ESM, `nodenext`)**, Express 5,
zod 4 for config and request validation, pino (`nestjs-pino`) for logs, `mysql2`
for the MySQL 8.4 pool, Vitest 5, ESLint 10 (type-aware) with Prettier, husky and
lint-staged. Schema: owned here, as SQL migrations run by our own per-step runner
(`src/core/db/migrator`); query layer: Kysely (both decided in `docs/m1-plan.md`).

- **TypeScript stays on 6.0.x**: typescript-eslint 8 supports `<6.1.0`. Dependabot
  ignores TypeScript minor and major bumps.
- **`npm run dev` uses `nest start --watch` (tsc), not tsx.** tsx (esbuild) does not
  emit decorator metadata, so Nest's type-based injection gets `undefined`. This was
  checked by running it: tsx gave `undefined`, while tsc and Vitest's oxc gave the
  instance.
- **`LOG_FORMAT=pretty` needs devDependencies.** The runtime image has no
  pino-pretty, so containers log JSON.

### Commands

| Purpose                                         | Command                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| install                                         | `npm ci`                                                                                     |
| build                                           | `npm run build`                                                                              |
| dev server (reload, reads `.env`)               | `docker compose up -d mysql && npm run dev`                                                  |
| migrate / roll back one (reads `.env`)          | `npm run migrate` / `npm run migrate:down` (`-- --all`, `-- --to <name>`)                    |
| demo data / regenerate row types                | `npm run db:seed` / `npm run db:types` (CI runs `db:types:check`)                            |
| verify (format + lint + types + openapi + unit) | `npm run verify`                                                                             |
| unit                                            | `npm test`                                                                                   |
| integration (real MySQL 8.4)                    | `docker compose up -d mysql && npm run test:int`                                             |
| coverage (floor 90% on every metric)            | `npm run test:coverage`                                                                      |
| regenerate the API document                     | `npm run openapi` (CI runs `openapi:check`)                                                  |
| real run (API + MySQL, over HTTP)               | `docker compose up -d --build`, then the requests in `http/`; `docker compose down -v` after |

Docker Desktop on this machine: set
`DOCKER_HOST=unix://$HOME/.docker/run/docker.sock` if the CLI cannot find the
daemon.

## File and folder structure

Two rules, applied at two levels.

### Level 1: feature modules, not technical layers

Inside `api/`, group by **feature**: `health/`, `profiles/`, `projects/`. Never
`controllers/` or `services/` at this level. Deleting a feature should mean deleting
one folder.

### Level 2: inside a module, one folder per role

This is the standard NestJS layout:

- `<name>.module.ts`, `<name>.controller.ts` and `<name>.service.ts` stay at the
  module root;
- then `dto/`, `services/`, `repositories/`, `guards/`, `decorators/`, `utils/` and
  `e2e/` as each appears.

Use the role folder even when it holds a single file.

### Top level

```
src/
  core/      shared, framework-light: config, logging, errors, db. Depends on nothing else in src/.
  api/       HTTP: main.ts, bootstrap.ts, api.module.ts, common/, health/, openapi/, feature modules
  testing/   test-only helpers; never imported by shipped code, excluded from the build
```

`src/architecture.test.ts` enforces this. Keeping `core` independent of `api` means
a second process (a worker for imports or PDFs) needs no untangling first.

### Naming

- Files are named `<subject>.<role>.ts`, with a NestJS role: `module`, `controller`,
  `service`, `repository`, `guard`, `decorator`, `pipe`, `filter`, `dto`.
- Pure helpers use plain kebab-case.
- Keep the subject prefix inside a role folder: `repositories/project.repository.ts`.
- Relative imports end in `.js` (`nodenext`).

### Tests

- `<file>.test.ts` sits beside the file it tests: unit tests, no I/O.
- `<file>.int.test.ts` is for anything that needs MySQL. It has a separate Vitest
  config and a separate CI job.
- Tests that span a whole module go in `<module>/e2e/<subject>.int.test.ts`.
- `src/testing/app.ts` builds the real app, the way `main.ts` does, for HTTP tests.

### Endpoints are finished only when

- `openapi.yaml` is regenerated: `OPERATIONS` in `src/api/openapi/document.ts`, then
  `npm run openapi`. `document.test.ts` fails on any route that is served but not
  documented, and on any route that is documented but not served.
- Its request is in `http/<module>.http`.
- Its ownership and visibility checks each have a test where a second user gets 404.

### When files move

Update the coverage exclusion paths in `vitest.config.mts`. They are literal paths,
so a move silently re-admits an excluded file.

## Other conventions

- **Configuration** is injected through `APP_CONFIG`, never read from a module-level
  singleton. Every variable is declared in `src/core/config/schema.ts` and validated
  at boot.
- **Logging** uses a static message, with variable data in fields. Tokens and private
  profile fields are redacted, and the query string is never logged.
- **Errors** carry a stable `code`. Internal detail goes to the log, never to a
  response (`src/core/errors/http-mapping.ts`).

### Facts every chat must know

These are established in `docs/investigation.md`; do not re-argue them.

- **The backend generates ids** (`newId()`). An INSERT that relies on `DEFAULT (UUID())`
  cannot return the new id (`LAST_INSERT_ID()` = 0); the row types make `id` required.
- **The API validates; CHECKs are the backstop.** Every JSON column and `YYYY-MM`
  column has a CHECK (0002: shape only). Lengths, URL schemes and item rules are the
  API's: `src/core/validation` (`columnString` counts what MySQL counts: characters for
  `VARCHAR`, bytes for `TEXT`). JSON is written only through `toJsonColumn(schema, v)`.
- **Session `time_zone` = `+00:00`.** `DATETIME` stores no time zone.
- **Skills, technologies and tags are one case-insensitive namespace.** They live in
  `user_skills`, `project_technologies` and `project_tags`; the `terms` registry fixes
  each one's spelling (`setUserSkills` / `setProjectTerms`). Never match with
  `JSON_CONTAINS` (exact), and never write a correlated `EXISTS`/`IN` over
  `JSON_TABLE(outer.col)`: MySQL 8.4.11 returns no rows for it.
- **Retry deadlocks with `inTransaction`.** A competing insert of the same unique key
  that rolls back makes InnoDB deadlock a waiter (1213), whatever the upsert SQL.
- **FULLTEXT ignores words shorter than 3 characters.** Search needs a fallback for
  terms like `AI`, `ML` and `Go`.
- **Column names are snake_case in the database and camelCase in the API.**
- **Identity:** the Auth0 access token's `sub` maps to `users.auth0_id`.
- **This repository owns the schema** (`src/core/db/migrations`). `gradfolio-sql` is
  reference docs; its `schema.sql` is frozen as `0001_baseline`.
