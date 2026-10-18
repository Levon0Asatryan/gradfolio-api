## Task

M1 follow-up: close plan PR #9's two unresolved Codex threads. P1 (4130257126): migration DML and its step record are not atomic. P2 (4130163504): the migrator's session time zone.

## Status

done. Written here because `gradfolio-repos-94` was not in ListAgents.

## Pull requests

**#14** Migrator: commit a DML step and its record in one transaction (#9 P1 follow-up). https://github.com/Levon0Asatryan/gradfolio-api/pull/14

- Head 65cbe12, MERGEABLE.
- CI: static, unit, integration, migrations and stack all pass.
- Reviewers: Codex reviewed 65cbe12 with no findings. Copilot FAILED (quota).
- Threads: 0/0. There was no fix push, so no second round or confirmation round was needed.

**#9 threads:** both now have a reply and are resolved (0 unresolved on #9).

- **P1:** replied with the #14 link and the evidence.
- **P2:** replied with the evidence, no code change.

## Investigation

- Every step in 0001–0004, classified. DML: 0003 up steps 4–14 (UPDATE/DELETE/INSERT … SELECT backfills) and 0003 down steps 2–3 (the UPDATE backfills). Everything else is DDL: CREATE/DROP TABLE and the guarded ALTERs.
- No step mixes DDL and DML. A step is one statement, and with `multipleStatements` off a second statement in one step is a syntax error.
- Run on MySQL 8.4.11: `BEGIN; DELETE …; INSERT INTO schema_migrations …;`
  - inside the transaction: skills=1, records=1;
  - after ROLLBACK: skills=2, records=0;
  - after COMMIT: skills=1, records=1.
- P2, run on MySQL 8.4.11 with `TZ=Asia/Yerevan`:
  - the server zone is +04 and the global `time_zone` is SYSTEM;
  - after `npm run migrate`, `MAX(applied_at)` = 09:45:13.451, `UTC_TIMESTAMP()` = 09:45:13.498, and the server's `NOW()` = 13:45:13.498;
  - so the registry is written in UTC, because `cli.ts:22` uses `createPool`, which runs `SET time_zone = '+00:00'` at `pool.ts:82-83`.

## What changed

- **Transactional DML steps.** `runStep` runs a DML step as `START TRANSACTION; step; recordStep; COMMIT`, and rolls back on any failure. DDL steps keep the guarded scheme; MySQL commits DDL implicitly.
- **Classification.** `isDml` is conservative: only a leading INSERT, UPDATE, DELETE or REPLACE counts as DML. Anything else stays on the DDL path: TRUNCATE, CREATE … SELECT, CALL, SET, and a leading comment or CTE.
- **Down migrations** follow the same rule, because it lives in `runStep`, which both directions share.
- **Which migrations it affects:** exactly 0003's 13 backfill steps. A unit test pins that list.
- **Nothing else:** no change to what any migration does.

## Revalidation

- `npm run verify`: 286 unit tests.
- `npm run test:coverage`: statements 99.13%, branches 96.98%, functions 98.86%, lines 99.66%.
- `npm run test:int`: 69/69.
- On an empty database:
  - `migrate` applies 0001–0004;
  - running it again prints `nothing to apply`;
  - `down --all` then `migrate` gives an identical schema (empty diff, 14 tables).

## Re-review

- /gradfolio-review passes 0–3 ran: no findings. The receipt method is `gradfolio-review`.
- Codex round 1 on 65cbe12: no findings.
- No regressions, no deferrals.

## Decisions made

- **DDL vs DML:** decided by a conservative leading-keyword rule rather than a marker in the migration files. There is nothing to forget when writing a migration, and an unrecognized statement falls back to DDL.
- **Failure in the test:** forced by a real trigger that refuses the `schema_migrations` insert after the step's statement has run, so the error comes over the real driver; no test-only hook was added to the runner.

## Evidence

Integration tests (MySQL 8.4), in `runner.int.test.ts` → `a DML step`:

- "commits the statement and its record together": the row is deleted and the record written;
- "leaves neither the change nor the record when recording fails after the statement": skills stay `['React', '']` and there are no records. After the trigger is dropped, the next run applies the step.

Existing DDL runner tests are unchanged and green.

| guard removed                                           | test that failed                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| the transaction (DML forced down the untransacted path) | `leaves neither the change nor the record…` (`expected ['React'] to equal ['React', '']`) |
| the conservative classifier (regex widened to `/./`)    | `files.test.ts`: `treats "CREATE TABLE …" / "ALTER TABLE …" / "DROP TABLE …" … as DDL`    |

Both rows were added to `docs/m1-verification.md` §10.

## Not verified

- **Copilot review:** quota exhausted ("Copilot: FAILED on 65cbe12"). Levon decides.
- **A killed process:** not simulated. The failure was forced by the server refusing the record instead. The outcome depends on the same property either way: the server rolls back an open transaction when its session ends.

## Defects found

None beyond the P1 being fixed.

## Changes needed in other repos

None.

## Open questions for Levon

- The Copilot quota.
- `gradfolio-api/.claude/settings.local.json`, created by /allow-all in this session, is **not gitignored**. Add `.claude/settings.local.json` to `.gitignore`, or it can be committed by accident. (It is untracked; I did not commit it.)

## Proposed tracker changes

- Follow-ups row "#9 review (P1)": done in #14.
- Note that #9's P2 was resolved as already handled (`cli.ts:22` → `pool.ts:82-83`).

## Machine clean

- **Started:** Docker Desktop, which was not running (`open -a Docker`); `gradfolio-api-mysql-1` with volume `gradfolio-api_mysqldata` and network `gradfolio-api_default`.
- **Removed:** the container, the volume and the network (`docker compose down -v`).
- **Left running:**
  - Docker Desktop itself;
  - `gradfolio-m2-mysql-1` and `gradfolio-m2_mysqldata`, which are not mine (another session's M2 worktree): not touched.
