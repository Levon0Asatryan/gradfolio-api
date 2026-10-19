# M7-T28: `GET /v1/me/suggestions?limit=100` answers 400

**Repo:** gradfolio-api and gradfolio (find which side is wrong first) · **Depends on:** — · **Tracker:** 7.13 · **Size:** one small PR
**Found on production, 2026-10-19 10:05 UTC.**

## Context

The frontend (`src/lib/integrations/suggestionActions.ts:56`) calls `listSuggestions({
limit: 100 })`. Production answered `400 VALIDATION_FAILED` to `GET
/v1/me/suggestions?limit=100`. The API schema on `main` allows `limit` up to 100
(`src/api/suggestions/dto/suggestion.dto.ts`), so either the deployed revision predates
that, the FE sends another parameter too (the log hides the query beyond `limit`), or the
schema differs from what the FE contract copy says (`src/lib/api/openapi.yaml`,
`openapi.source`).

## Goal

The profile-data tab and the inbox load their suggestions on production.

## Scope

In: reproduce with a real request against the deployed revision's contract (read the
deployed revision's `openapi.yaml` from the commit it was built from), find the mismatch,
fix the wrong side, add a contract test so the FE's call shape cannot drift (the FE
`schema.test.ts` already guards the types; check what it misses). Out: new features.

## Acceptance

`GET /v1/me/suggestions` with the FE's exact query returns 200 against the API locally;
a test fails if the FE asks for a limit above the API's maximum.

## Needs Levon

Nothing.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Read every review thread before you report, and report "reviewed" only for
the exact head Codex reviewed. Never write a secret, a token or real user data into a
file, a PR or a chat.
