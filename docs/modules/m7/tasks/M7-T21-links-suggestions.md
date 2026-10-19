# M7-T21: Links suggestions from GitHub social accounts

**Repo:** gradfolio-api · **Depends on:** T20 (same files) · **Tracker:** 7.13 (proposed) · **Size:** one PR

## Context

As in [M7-T20](M7-T20-skill-suggestions.md): suggestions live in `src/api/suggestions/`;
the refresh already reads `GET /user`. GitHub also exposes `GET /user/social_accounts`
(LinkedIn, X, YouTube, Mastodon, …; one call, public data, no extra scope; confirmed
200 on a real account in the M7 investigation, plan §14). The profile has `links.*` fields
(see `src/api/profiles/` and `src/core/validation`).

## Goal

The student is offered their LinkedIn, X and similar links from GitHub, to fill empty link
fields, accepted or dismissed one at a time.

## Scope

In:

- Kinds `profile.links.<provider>` for providers the profile has a field for; others are not
  offered (say which in the PR).
- Offer only when the profile field is empty (`mode: fill`); never replace a filled one.
- URL validated like manual entry (scheme allow-list, length).
- OpenAPI, request in `http/`, tests as in T20, ownership and second-user 404.

Out: the UI (T32); emails and orgs (T25).

## Decisions

Made: fill only, never replace. **Levon decides:** nothing.

## Acceptance

- A GitHub profile with a LinkedIn social account and an empty LinkedIn field yields one
  suggestion; with a filled field, none. Accept writes the field through the profile rules.
- An unsafe URL (`javascript:`) is dropped, with a test.
- Guards proved by removal: fill-only, URL validation, ownership.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
