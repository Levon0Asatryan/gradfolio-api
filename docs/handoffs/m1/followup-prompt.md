You are a worker chat on gradfolio-api, the backend API for Gradfolio: a student
portfolio platform (NPUA coursework) that serves the Next.js frontend from MySQL 8.4.
Repo: /Users/levon/Dev/university/gradfolio-repos/gradfolio-api
(GitHub Levon0Asatryan/gradfolio-api).

Read these first, in order:

1. CLAUDE.md
2. AGENTS.md
3. docs/tracker.md (the Follow-ups row "#9 review (P1)")
4. docs/m1-plan.md
5. docs/m1-verification.md

## Task

The M1 leftover: close the two unresolved Codex threads on the merged plan PR #9. One
of them needs a code fix.

1. **P1 (comment 4130257126): a migration's DML and its step record are not atomic.**
   - In `src/core/db/migrator/runner.ts`, `runStep` runs the step's SQL on
     autocommit, then calls `recordStep` separately.
   - For a DML step (0003's `UPDATE` and `DELETE` on `user_skills`), a crash between
     the two leaves the data changed while the step is still unrecorded.
   - Every current DML step is idempotent, so a re-run converges and nothing is lost
     beyond what the migration intends. The gap is still cheap to close.
2. **P2 (comment 4130163504): the migrator session's time zone.** This is already
   handled in code: `src/core/db/migrator/cli.ts` builds its pool with `createPool`,
   which pins `time_zone = '+00:00'` on every connection. Reply with that evidence
   (file and line) and resolve the thread. No code change.

## Scope

In:

- A step that contains **no DDL** runs as `BEGIN; <step>; recordStep; COMMIT`.
- A step that contains DDL keeps today's guarded scheme. MySQL commits DDL
  implicitly, so a transaction cannot help it.
- Decide how a step is classified as DDL or not.
  - Prefer an explicit marker in the migration file, or a conservative rule: anything
    not provably DML is treated as DDL.
  - Guessing from statement text is risky. If you parse the SQL, a statement you
    don't recognise must fall back to DDL.
- Down migrations follow the same rule.
- Tests (integration, MySQL 8.4):
  - a DML step that fails after its statement, before its record, leaves **neither**
    the data change nor the record visible;
  - a normal DML step leaves both;
  - DDL steps behave exactly as before (the existing runner tests stay green);
  - prove the new guard by removing the transaction: the first test must then fail.
- Update `docs/m1-verification.md` §10 (guard proofs) with the new row.

Out:

- Any change to what the migrations do.
- New migrations.
- Anything in M2.

## Starting point

Branch from the latest origin/main. M1 is merged: #9, #11, #12 and #13.

## Phase 1: Investigation

- Read `runner.ts`, `registry.ts`, `files.ts` and their tests. List every step in
  0001–0004 and classify each one as DDL or DML.
- Run it, don't recall it: on MySQL 8.4 (`docker compose up -d mysql`), show that
  `BEGIN; DELETE ...; INSERT INTO schema_migrations ...; ROLLBACK` leaves both
  unchanged.
- Check whether any current step mixes DDL and DML in one step. If one does, it must
  be treated as DDL; say so.

## Phase 2: Implementation

Keep it small: one PR, commits split by logical change.

## Phase 3: Revalidation

- `npm run verify`, `npm run test:coverage` and `npm run test:int` all green.
- On an empty database:
  - `npm run migrate` applies 0001–0004;
  - running it again changes nothing;
  - `down --all` then `migrate` gives an identical schema (the existing baseline
    check).
- Guard proof by removal, recorded in the PR.
- Leave the machine clean: list the containers and volumes you started, and confirm
  each is removed.

## Phase 4: Re-review

- Run /gradfolio-review. If the skill is not loaded in your session, run its passes
  by hand and write the receipt with an honest `method`.
- **Both reviewers on every push:** `sh scripts/request-review.sh <pr>`.
- The head counts as reviewed only when `sh scripts/review-status.sh <pr>` exits 0.
  - Copilot's review quota is exhausted, so it will report "Copilot: FAILED".
  - That is expected until Levon decides on the quota. Record it under "Not verified".
- Two rounds, then fix-now findings only. The last fix push gets one confirmation
  round on the head commit.
- Then reply on PR #9's two threads, with the PR link for the P1 and the evidence for
  the P2, and resolve both.

## Stop points

- Do not merge. Do not push to main. Do not edit docs/tracker.md; propose changes in
  your report.

## When to report

Send one report, when the PR is finished: pushed, CI green, review rounds done, #9
threads resolved, machine clean.

Send it to the orchestrator session **gradfolio-repos-94** with SendMessage, in the
format from docs/handoff-template.md, part 2. If that session is not listed in
ListAgents, write the report to
`/Users/levon/Dev/university/gradfolio-repos/m1-followup-report.md` instead.
