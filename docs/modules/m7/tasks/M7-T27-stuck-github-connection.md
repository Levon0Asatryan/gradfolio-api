# M7-T27: Stuck GitHub connection: refused token and a Disconnect that cannot finish

**Repo:** gradfolio-api · **Depends on:** — · **Tracker:** 7.2 · **Size:** one PR
**Found on production, 2026-10-19 (Levon's account).**

## Context

Evidence from Cloud Run (no tokens in it): GitHub was connected on 2026-10-18 13:47 UTC.
On 2026-10-19 at 10:04 UTC `GET /v1/me/github/repos` answered `409 GITHUB_NOT_LINKED` four
times (GitHub refused the token Auth0 holds, mapped in `src/core/github/github-client.ts`),
and at 10:05 `DELETE /v1/me/integrations/github` answered `502 GITHUB_REVOKE_FAILED` with
the unknown-outcome wording. The account is stuck: it cannot import and cannot disconnect.

Why GitHub refused the token is **not known**. Candidates: the student revoked the
Gradfolio authorization at GitHub; the OAuth App's secret or the grant changed; Auth0's
stored token is stale. The code treats only HTTP 422 as "the grant is already gone"
(`GRANT_ALREADY_GONE` in `github-client.ts`; the comment says a 404 could also mean a wrong
client id). The real status GitHub returned for this DELETE is not in the log: the failure
line does not carry it. That is the first real data point for plan §2.5, and it is missing.

## Goal

A student whose GitHub token is dead can get out of that state, and the next failure
tells us what GitHub said.

## Scope

In:

- Log the **upstream status** (a number, never a body or a token) on every GitHub call that
  fails: the revoke, the token check, `GET /user`, the repo list.
- Decide, with evidence from the logged status, which answers to `DELETE
/applications/{client_id}/grant` mean "already gone". If the token itself is refused by
  GitHub (401 on a plain `GET /user` with it), the token is dead, which is what revocation
  is for: disconnect completes. A 404 or 403 on the revoke is treated by what a probe with
  a known-dead token returns, not by assumption: write the probe as a test against the fake
  AND record what real GitHub does in the PR body once the first real case is logged.
- The `linking` marker left by an ambiguous revoke settles from GitHub's word as designed
  (plan §2.3). Check why a retry after the deadline did not complete in the real case, if
  it did not.
- A student with a dead token sees an accurate message and a way out: "Connect GitHub
  again" re-links (idempotent, #85) and refreshes Auth0's token.
- OpenAPI text, tests (fake GitHub over real HTTP: dead token on repo list, on revoke),
  guard removal.

Out: FE copy (the FE already shows the unsettled wording); Auth0 user deletion.

## Decisions

Made: revocation is mandatory (plan D9): a dead token counts as revoked, a live one does
not. **Levon decides:** nothing; he retries Disconnect once after this deploys, so the
logged status is captured.

## Acceptance

- With the fake returning 401 for the token, `DELETE …/github` completes and the row is
  `not_connected`; with a live token and a 5xx it stays unsettled as today.
- Every failing GitHub call logs its status number; a grep of the test logs finds no token.
- Guards proved by removal: the dead-token path, the status field, the marker settlement.

## Needs Levon

After the deploy: retry Disconnect on the stuck account once, then read the logged status
(the module chat does), and reconnect GitHub to confirm an import works again.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Read every review thread before you report, and report "reviewed" only for
the exact head Codex reviewed. Never write a secret, a token or real user data into a
file, a PR or a chat.
