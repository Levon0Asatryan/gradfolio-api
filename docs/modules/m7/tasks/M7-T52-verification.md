# M7-T52: Verification records and the module report

**Repos:** gradfolio-api, gradfolio · **Depends on:** all tasks above (or their
"not run by decision" record) · **Size:** two docs PRs

## Context

Per CLAUDE.md "Before calling it done" item 6: `docs/modules/m7/verification.md` (API) and
the frontend record `docs/fe-m7-verification.md` in `gradfolio`. The interim report is
[../../../process/handoffs/m7/report.md](../../../process/handoffs/m7/report.md).

## Goal

What was run and what it produced, including defects found, and the final M7 report.

## Scope

In: a fresh clone passes verify, coverage at or above the floor and the integration suite
(API); `npm run verify`, coverage, build and the Playwright suite (FE); a second-user matrix
(404 on every write); a grep proving no token appears in a response or a log; the crypto
statement (no token is stored: show the schema and a test); the ZIP corpus results; the real
run records (T50, T51); production `/readyz` 200; guard-removal tables; the list of merges
made outside the lead's gate; "Proposed tracker changes" for the main chat; the queue state.

## Acceptance

The exit lines of [../README.md](../README.md) each point to evidence. Machine clean: no
containers, worktrees or scratch files left.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
