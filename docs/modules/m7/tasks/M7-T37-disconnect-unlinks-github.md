# M7-T37: Disconnect unlinks the GitHub identity at Auth0

**Repo:** gradfolio-api (frontend wording only if a string changes) · **Depends on:** T36 (merged) · **Tracker:** 7.4 · **Size:** one PR
**Status:** ready. **Decided by Levon 2026-11-01: yes**, so the same GitHub account can be connected to another Gradfolio account.

## Goal

Disconnect removes the GitHub identity from the Auth0 user (after the grant is revoked), so
a later Connect, on this or another Gradfolio account, starts clean. It is the same
Management API call the account-deletion path already uses (`update:users` scope is held).

## Scope

In:

- Disconnect: revoke the grant (existing rules), then unlink the identity. Order and failure
  rules: if revocation is unconfirmed, keep the `linking`/unconfirmed behaviour from T27;
  if unlinking fails, the answer says honestly that GitHub access was removed but the
  identity is still linked, and a retry finishes the job (idempotent: an already-unlinked
  identity is success).
- The `GITHUB_NOT_LINKED` and reconnect paths of T27/T36 keep working; test connect after a
  full disconnect on the same account and on a second account.
- Update OpenAPI, `http/integrations.http`, plan §2.3. Check the frontend Disconnect
  confirmation text still says what happens; if a string changes, a small FE PR or a note in
  Needs Levon.
- Guards proved by removal: unlink after revoke, unlink failure answer, idempotent unlink.

Out: deleting the Auth0 user (that is `AUTH0_DELETE_USERS`, T23/M7-T13).

## Needs Levon

After deploy: Disconnect, then connect the same GitHub account to a second Gradfolio account.

## Rules

Follow [../../README.md](../../README.md) and [../README.md](../README.md). Read `CLAUDE.md`
and `AGENTS.md` first. Report in the PR body (`docs/process/handoff-template.md`, part 2).
Do not merge. Never write a secret or token into a file, PR or chat.

## Found by Levon on production, 2026-11-01

Signed up with GitHub, pressed Disconnect, then opened a second account (Google) and pressed Connect with the same GitHub account:
"That GitHub account already belongs to another Gradfolio account." The identity is still linked to the first user at Auth0.

Case to handle: the account was **created by signing in with GitHub**, so GitHub is its *primary* identity. Auth0 cannot unlink a primary identity. Do not pretend it worked:
- Disconnect still revokes the grant and clears the Gradfolio-side link, and says plainly that the GitHub login stays on this account because it is how the user signs in.
- The Connect error for that case must say what to do (sign in to the first account, or use a different GitHub account), not only "already belongs".
- Test both cases: secondary identity (unlinked) and primary identity (kept, honest answer). Prove each guard by removal.
