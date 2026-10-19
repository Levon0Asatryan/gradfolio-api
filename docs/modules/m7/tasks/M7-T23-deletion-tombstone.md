# M7-T23: Deletion tombstone, the precondition of `AUTH0_DELETE_USERS`

**Repo:** gradfolio-api · **Depends on:** — · **Tracker:** 7.2 · **Size:** one PR

## Context

With `AUTH0_DELETE_USERS=true`, account deletion also deletes the Auth0 user (PR #86; code
in `src/api/me/services/account.service.ts`, plan §2.8). A request carrying the
still-valid access token can then re-provision an empty, **public by default** `users` row
from the token's claims (`UsersService.resolve`), bound to a login that no longer exists;
nothing removes it. Codex's finding on #85, accepted as real by the M7 lead. The boot
currently warns while the tombstone is not built (PR #89).

## Goal

A deleted subject is not re-provisioned for the lifetime of its access token.

## Scope

In:

- A small table (additive migration, next free number on the latest `main`) of deleted
  `sub`s with an expiry (the token lifetime plus margin), written in the account-deletion
  transaction, and a purge of expired rows.
- `UsersService.resolve` refuses a tombstoned `sub` (stable error code, 401-class, no row
  created), with the race (deletion committing while another request provisions) forced by
  a barrier.
- Only active when the flag is on? Decide in the PR; a tombstone is harmless when off, and
  simpler if always on.
- The boot warning from #89 becomes a refusal to start with the flag on only if the
  tombstone is missing, or is removed.
- Account deletion test: delete, then a call with the old token gets the refusal and no row.

Out: enabling the flag (queue M7-T13, Levon).

## Decisions

Made: tombstone by `sub` for the token lifetime. **Levon decides:** nothing; he enables the
flag afterwards.

## Acceptance

- Migration applied twice leaves nothing; `down` then `up` identical.
- Barrier test: provisioning racing a deletion never leaves a row.
- Guards proved by removal: the tombstone check, the write in the deletion transaction, the purge.

## Needs Levon

After merge: queue M7-T13 (scope `delete:users` on the M2M app, `AUTH0_DELETE_USERS=true`).

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
