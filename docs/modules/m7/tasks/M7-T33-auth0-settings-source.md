# M7-T33: One source for the Auth0 settings the app reads

**Repo:** gradfolio · **Depends on:** — · **Tracker:** 7.11 · **Size:** one small PR

## Context

`AUTH0_DOMAIN` is read in three places with different expectations: the Auth0 SDK (accepts
a scheme), `startGithubConnectAction` and the GitHub callback route (needed a bare host).
Production's value held `https://` and Connect silently failed until FE #106 normalised it
in the two places. Also `AUTH0_GITHUB_CONNECTION` (FE #107, `src/lib/integrations/`).

## Goal

One function returns the validated Auth0 settings the connect flow needs, and logs, by
name only, which are unusable.

## Scope

In: one module (e.g. `src/lib/auth/auth0Settings.ts`) used by the action and the callback;
tests for scheme, slash, whitespace and case; no value is ever logged. No change to the SDK
client in `src/lib/auth0.ts`.
Out: Vercel dashboard changes (Levon's queue OR-T5: delete stale `AUTH0_ISSUER_BASE_URL`
and `AUTH0_BASE_URL`, recreate secrets as Sensitive).

## Decisions

Made: normalise rather than reject. **Levon decides:** nothing.

## Acceptance

Existing tests for the action and callback still pass through the new module; a guard
removed (normalisation) fails a named test; `verify`, coverage, build.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
