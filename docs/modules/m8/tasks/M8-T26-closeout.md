# M8-T26: Module close-out

**Repo:** gradfolio-api, gradfolio · **Depends on:** T21, T23, T24 · **Tracker:** — · **Size:** two small docs PRs

## Goal

M8 is closed with an honest record.

## Scope

In:

- `docs/modules/m8/verification.md` gets the T10 table at its top: each acceptance step, PASS,
  FAIL or GAP, with a link to the evidence from T21, T23 and T24. The long running log below it
  stays as history.
- `docs/modules/m8/report.md`, in the handoff template format, with "Proposed tracker changes"
  and "Needs Levon". It lists any step left as an accepted GAP.
- The task table: every task `done` or `closed`, and the module status set.

## Acceptance

Nothing is marked PASS without evidence. An accepted GAP names who accepted it and when.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
The audit that opened this task is [../audit-2026-11-01.md](../audit-2026-11-01.md). Report in the PR
body (`docs/process/handoff-template.md` part 2). Do not merge. Never write a secret into a
file, a PR or a chat.
