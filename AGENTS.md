# gradfolio-api

Backend API for **Gradfolio**, a student portfolio platform built as NPUA university
coursework. Students use it to show their projects, skills and achievements, with
evidence attached, to recruiters and peers. The API serves the Next.js frontend
([gradfolio](https://github.com/Levon0Asatryan/gradfolio)) from a MySQL 8.4 database
([gradfolio-sql](https://github.com/Levon0Asatryan/gradfolio-sql)).

- **Stack:** NestJS 12, Node 24, TypeScript 6.0 (ESM). zod validates config and
  requests, and generates `openapi.yaml`. pino for logging, `mysql2` for the pool,
  Vitest for tests. The query layer is still an M0 decision.
- `src/core` depends on nothing else in `src/`, and `src/api` depends on `core`.
  `src/architecture.test.ts` enforces this.
- `npm run verify` runs format, lint, types, the OpenAPI check and the unit tests.
  `npm run test:int` runs against a real MySQL 8.4.
- **Identity:** requests carry an Auth0 access token (`Authorization: Bearer`). The
  token's `sub` maps to `users.auth0_id`.
- **Scale:** university coursework. Tens of users, hundreds of projects, Aiven's free
  MySQL tier.
- The schema facts below were verified by running them against MySQL 8.4.11; the
  evidence is in `docs/investigation.md` §3.2.

## Code Review Rules

Read by both reviewers of record: Codex (from this file) and GitHub Copilot (through
`.github/copilot-instructions.md`, which points here). Every push is reviewed by both.

### What to report, and what to leave alone

This is university coursework on a deadline. Every review round costs the author five
to seven minutes of waiting. A review that lists nine things, of which two matter,
costs more than one that lists only those two. So the bar is deliberately high.

**Report a finding only if it is one of these:**

- a **wrong result**: a number, status or verdict a user would read and trust, but
  which is not what the code computes;
- a **security hole**: injection, SSRF, a secret in a log or response, an
  authorization gap;
- **data loss or corruption**, including a lost update or a broken invariant;
- a **concurrency defect**: a duplicate, a lost claim, a race, a deadlock;
- a **broken build, a broken test, or a test that cannot fail**, including a test that
  passes for a reason other than the behaviour it names;
- a **resource leak** that a long-running process would accumulate;
- a **documented contract violated**: the code contradicts a sentence in
  `docs/mN-plan.md`, an ADR, the API document or the requirements.

**Do not report:**

- formatting, import order, naming style or type errors, because the formatter,
  linter and type checker already block on those in CI;
- suggestions phrased as "consider", "it might be cleaner" or "a more idiomatic way",
  or a preference between two correct ways of writing something;
- defensive code for inputs that the type system or validated config already rules
  out;
- hardening or generality that only pays off at a scale this system will never reach;
- missing tests for a case that is already covered, or coverage as a number rather
  than a named behaviour that isn't tested;
- anything already recorded as a deferred follow-up in `docs/tracker.md`.

### Reviewing a design document

A plan is a **proposal**, not something that can be proved correct. It has no tests,
and each fix adds more prose and opens new surface.

On a plan, report only what changes the **design**:

- a contradiction with a requirement, an ADR or measured evidence;
- an arithmetic or logical error in a stated invariant or bound;
- a security property missing from an endpoint or surface it should cover;
- a test the plan specifies that could not fail.

Do **not** report wording, completeness or ordering. **One round on a plan, then it
merges.**

**Shape of a finding.** One comment per defect, not one per occurrence. State the
concrete failure: the input, the wrong behaviour that results, and why. A finding that
asserts a fact (a limit, a default, a specification, how a library behaves) must cite
it, because the author is told to check the premise and push back with evidence when
it is wrong.

### Concurrency and data integrity

- Flag read-modify-write on shared rows. Counters are incremented inside SQL.
- Flag a check-then-act sequence that spans an `await` or a separate query without
  holding a lock, or re-acquiring one and re-checking right before the write.
- Flag locks taken in inconsistent order, and a value read before the lock that
  decides the outcome.
  - InnoDB: an insert into a table with a foreign key takes a shared lock on the
    parent row. That hidden lock can reverse a lock ordering.
  - Under the default REPEATABLE READ isolation, locking reads and unique-index
    inserts also take gap and next-key locks.
- Flag a multi-step write that can half-commit, and retryable work that is not
  idempotent.
  - Example: "replace all skills" (DELETE then INSERT) is one transaction.
- Flag first-login user provisioning that is not race-safe. Two concurrent first
  requests for one `auth0_id` must produce one row: upsert, or catch the duplicate-key
  error 1062 and re-read.
- Flag an INSERT that relies on the database's `DEFAULT (UUID())` and then needs the
  id. `LAST_INSERT_ID()` is 0 for these tables, so the backend supplies the UUID.
- Scripts, backfills and migrations are not exempt from any of this.

### Failure handling

- Flag a swallowed failure: an empty catch, an ignored rejection, a fallback that
  hides the cause.
- Flag a guard whose condition can silently match zero rows. A write that touches zero
  rows is not an error, so the guard fails open.
  - `UPDATE … WHERE id = ? AND user_id = ?` that changed 0 rows must become a 404, not
    a 200.
  - An equality check on a value that crosses the driver boundary (for example a
    `DATETIME` parsed into a language date type) needs a test proving it matches the
    row it should.
- Flag a long-running loop or job that can exit silently when its work throws.
- Flag a destructive change whose only record is written after the change commits.

### Security

- Flag internal detail reaching a response: stack traces, SQL, driver messages,
  internal addresses. Responses carry a stable code and a safe message; the cause goes
  to the log.
- Flag `403` where a resource belongs to another user. Use `404`.
- **Ownership:** flag any write to a user-owned row that is not scoped to the caller.
  - Every UPDATE or DELETE on a user-owned row has `user_id = <caller>` in its WHERE
    clause, or goes through the owning project.
  - `queries.sql` 7c (notifications) and 8a (team invite) are known examples of this
    mistake.
- **Visibility:** flag a public read path (profile, project, search, browse, tag,
  teammate listing) that returns a row with `is_public = 0` to anyone other than its
  owner, unless the privacy rule chosen in the M0 plan allows it.
- **Private fields:** flag `birthday`, `phone`, `integrations.*_token`,
  `external_user_id` or `auth0_id` appearing in any response other than the owner's
  own settings. Tokens never appear in any response.
- **OAuth tokens** are encrypted before they are written to the database. Flag
  plaintext writes.
- **Stored HTML:** `projects.description_html` is sanitized on write with an allow-list
  sanitizer. The frontend renders it with `dangerouslySetInnerHTML`, and its own
  regex-based cleaner can be bypassed. Flag any write path that skips the sanitizer,
  and any sanitizer that works with regexes or a deny-list.
- **URLs:** flag user-supplied URLs stored without checking the scheme (only `https:`
  and `http:`; never `javascript:` or `data:`).
- **SSRF:** flag the server fetching a URL the user supplied. Imports go through the
  GitHub API only.
- **Token checks:** flag access-token verification that does not check the signature
  against the JWKS, the issuer, the audience and the expiry, or that accepts `alg: none`
  or HS256.
- Flag a user-supplied key used to index an object or map without an own-property
  check.
- Flag a new expensive or security-sensitive endpoint (search, import, AI summary, PDF,
  email) with no rate limit, and one endpoint sharing another's rate-limit budget.
- Flag validation against an approximation of a downstream limit instead of the real
  one.
  - MySQL `VARCHAR(n)` counts characters, not bytes, under utf8mb4.
  - `SMALLINT` years, and `TEXT` at 65,535 bytes.

### MySQL specifics

- Flag writing to a JSON column a value that has not been validated against its
  documented shape (`string[]`, or `{label, url}[]`). MySQL accepts any valid JSON
  here.
- Flag writing to a `YYYY-MM` column (`experience.start` and `end`,
  `certifications.date`) a value not validated as `YYYY-MM`.
- Flag tag or technology matching that is case-sensitive: `JSON_CONTAINS` compares
  exactly.
- Flag search that relies on FULLTEXT alone for short terms. It ignores words shorter
  than 3 characters.
- Flag a connection that does not set the session `time_zone` to `+00:00`.
- Flag string-concatenated SQL. Every value is bound as a parameter.
- Flag re-inviting a teammate with an INSERT: the unique key on
  (`project_id`, `user_id`) rejects it. The row must be updated instead.

### Tests

- Flag a bug fix with no test that fails without it.
- Flag a focused or skipped test.
- Flag a race proved with a sleep instead of a barrier.
- Flag a new guard, filter, check or config bound with no test proving it **fails**
  when it should. For authorization, that means a test where a second user gets a 404.
- Flag a test asserting on implementation detail rather than behaviour.
- Flag integration tests that run against anything other than MySQL 8.4, such as H2,
  SQLite or a mocked repository, for code whose behaviour depends on MySQL.

### Configuration and migrations

- Flag a literal where configuration belongs: timeouts, limits, intervals, page sizes.
- Flag a migration without its down migration, and a new validation rule with no plan
  for rows that already break it.
- Flag a schema change made here that is not reflected in wherever the M0 plan says
  the schema lives.

### Design docs and plans

- Flag a claim about library or runtime behaviour taken from memory instead of run,
  or run against a version the project does not pin.
- Flag a fix that duplicates the thing it was fixing instead of sharing it, and a fix
  applied to one instance of a pattern without checking the others.
- Flag a correction that was never itself reviewed as new work.
