# M7-T36: Connecting after a dead token loops on 409; reconnect must re-run the GitHub sign-in

**Repo:** gradfolio-api (and gradfolio for the new connect answer) · **Depends on:** — · **Tracker:** 7.2 · **Size:** one PR per repo
**Found on production, 2026-10-19 (Levon's account).**

## Context: the evidence

Cloud Run, 2026-10-19 UTC (no tokens in it):

- 11:58:35 and :36 `GET /v1/me/github/repos` 409 `GITHUB_NOT_LINKED` (GitHub refuses the token Auth0 holds).
- 11:58:39 `DELETE /v1/me/integrations/github` 200, log `github grant revoked` with result `token_refused`, then `github disconnected` (T27 works: a dead token counts as revoked).
- 11:58:42 and :47 `POST /v1/me/integrations/github/connect` 409 `GITHUB_NOT_LINKED`. **This is the defect.** The student clicked Connect again, the API found the GitHub identity still linked at Auth0, looked at the token Auth0 keeps, GitHub refused it, and the API answered an error instead of starting the sign-in. The message tells the student to "connect again", which gives the same answer: a loop.
- The student then logged out and in with GitHub (a fresh token reached Auth0) and `POST …/connect` answered 200, `github connected` at 11:59:01. Import, preview, refresh and two accepts then worked.

## Why the token dies (what is known, what is not)

- A revoke of the OAuth grant (our disconnect, our account deletion, or the student at
  github.com/settings/applications) kills **every** token that user holds for the app,
  including the one Auth0 stores in the linked identity. Auth0 is never told, and the identity
  stays linked. Our own `disconnect` therefore leaves a dead token behind.
- What killed the token before the very first failure on 2026-10-19 10:04 is **not known**
  (no revoke call of ours appears in the 26 h before it). Do not claim an expiry: GitHub OAuth
  App tokens do not expire on a timer. Record it as unknown in the PR.

## Goal

A student whose saved token is dead is sent through the GitHub sign-in to get a fresh one,
by one click on Connect, never an error loop.

## Scope

In (api):

- `POST /v1/me/integrations/github/connect`: when the GitHub identity is linked but the token is
  missing or refused, answer the **authorize** state (nonce) exactly as for a not-yet-linked
  account, instead of `409 GITHUB_NOT_LINKED`. Keep `GITHUB_NOT_LINKED` for the read routes
  (repos, import, sync, refresh), where there is no sign-in to start.
- The link step after the sign-in: read the **fresh** token from Auth0 (bypass and refresh the
  in-memory token cache for that login; today `forget` must run so a cached dead token cannot
  be re-read), check GitHub accepts it, then finish as connected. A token still refused after a
  fresh sign-in is `409 GITHUB_NOT_LINKED` with a precise log line (upstream status number).
- Tests with the fake Auth0 and fake GitHub over real HTTP: dead token then connect starts the
  flow; fresh sign-in then connected; cached dead token not reused; barrier test for two
  connects at once. Guard removal for each branch. OpenAPI text, `http/`.

In (gradfolio): none if the connect answer keeps its existing authorize shape (the frontend
already follows `result.url`); check `startGithubConnectAction` and the card, and add a test
that this case redirects to Auth0.

**Levon decides (default: no):** also unlink the GitHub identity from the Auth0 user on
`disconnect`, as account deletion already does, so a reconnect is a clean link and no dead token
stays behind. It re-creates a standalone `github|<id>` Auth0 user (plan §2.7, harmless). It is
not needed for the fix above.

## Acceptance

- Reproduce the log sequence above against the fakes: dead token, disconnect, connect gives the
  authorize state (not 409), fresh sign-in, connected, import works.
- The number of GitHub calls per connect is stated in the PR.

## Not verifiable here

That Auth0 replaces the stored GitHub token when the student signs in again with the GitHub
connection (the observed 11:59 behaviour says yes). The first real run (M7-T50) confirms it;
write it under "Not verified".

## Needs Levon

After the deploy: Disconnect, then Connect on the same account once, without logging out.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, cleaning up, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Read every review thread before you
report, and report "reviewed" only for the exact head Codex reviewed. Never write a secret,
a token or real user data into a file, a PR or a chat.
