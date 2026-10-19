# M7-T50: Real GitHub run on production

**Repos:** gradfolio-api, gradfolio · **Depends on:** T20, T30, T31 deployed · **Tracker:** 7.1–7.5, 7.13 · **Size:** no feature code; a run and a record

## Context

[../prod-run.md](../prod-run.md) is the checklist and `scripts/m7-prod-observe.sh` /
`scripts/m7-prod-verdict.py` the read-only observer (Cloud Run log fields projected one by
one, env var names only, never values). The run needs a fresh account, since the first
run on 2026-10-15/16 hit the reconnect defect (fixed in #85/#88). Evidence so far
(2026-10-18): imports and one re-sync worked; disconnect and suggestion accept/dismiss were
not seen in the logs.

## Goal

Every GitHub step of the M7 exit works on production, and the record says what was seen.

## Scope

In: Levon logs in headed (never gives a password or token), the chat drives the checklist
and reads the log: connect; import two repositories (with an edit before save); publish one
from the card; re-sync (edits survive); accept a skill and a link suggestion; dismiss one;
disconnect (grant gone at GitHub, nothing linked in Auth0); delete the account (signs out,
no recreated account); reconnect after deletion. Fill in the open questions of plan §2.1/§16
from what was seen. Write the GitHub half of `verification.md`.
Out: fixing defects found: each becomes a task.

## Decisions

**Levon decides:** nothing.

## Acceptance

Each step has the request seen and the result, not "tested". A defect found is listed with
its evidence and becomes a new task row.

## Needs Levon

Queue M7-T4/T6: the headed login and the clicks, about 15 minutes.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
