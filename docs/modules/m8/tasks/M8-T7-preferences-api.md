# M8-T7: Preferred language and email preferences (API)

**Repo:** gradfolio-api · **Depends on:** — · **Tracker:** 8.7, 8.8 · **Size:** one PR

## Context

Emails are sent in the recipient's language, and a user must be able to turn invite
emails off. The API has no stored language today (the frontend keeps the UI language in
the browser). Read `src/api/me` and `src/api/users` for how `/v1/me` and the account
settings work.

## Goal

The API stores a preferred language and per-type email preferences, and exposes them on
`/v1/me`.

## Scope

In:

- Migration (additive): `users.preferred_language` (`en|ru|am`, default `en`) and email
  preferences (a small JSON column or a table; the first type is `team_invites`,
  default on). Applied twice, nothing left; `down` then `up` identical.
- `GET /v1/me` includes both. `PATCH /v1/me/settings` changes them, validated, owner-only,
  rate-limited; it's in `openapi.yaml` and has a request in `http/`.
- First login sets the language from a header the frontend sends (`Accept-Language` or an
  explicit field), only when nothing is stored yet.
- Unsubscribe by link: a signed, expiring token endpoint
  `POST /v1/email/unsubscribe` that turns one type off without a login (the link in an
  email). The token carries the user id and type, and nothing else; it can't be reused to
  turn things back on. Tested for tampering and expiry.
- Account deletion removes this data.

Out: the Settings UI (T9), sending (T8).

## Acceptance

- Ownership and second-user tests; a tampered or expired unsubscribe token is refused;
  the stable error codes are documented.
- Guards proved by removal: validation, the token signature check, the default.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Never write a secret into a file, a PR or a chat.
