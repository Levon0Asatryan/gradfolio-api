# M7-T24: Startup check: which GitHub setting is missing

**Repo:** gradfolio-api · **Depends on:** — · **Tracker:** 7.2 · **Size:** one small PR

## Context

GitHub connect needs five settings (`AUTH0_CLIENT_ID`, `AUTH0_M2M_CLIENT_ID`,
`AUTH0_M2M_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`;
`githubIntegrationSettings` in `src/core/config/schema.ts`). With any one missing, every
GitHub route answers `503 INTEGRATION_UNAVAILABLE` and `github.available` is false, and
nothing says which setting is missing. This cost an hour of diagnosis on 2026-10-15.

## Goal

At boot the API logs which settings are missing, never their values.

## Scope

In:

- One structured warning at startup (message static, field `missing: [names]`) when some but
  not all five are set; one info line when none are set ("GitHub connect not configured");
  nothing when all are set.
- A test of the three cases and that no value is ever logged.

Out: changing the 503 behaviour.

## Decisions

Made: log only, do not refuse to start. **Levon decides:** nothing.

## Acceptance

- Unit test for each case; guard removed (the names list) fails a named test; `verify` passes.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
