# M7-T32: Suggestions inbox

**Repo:** gradfolio · **Depends on:** T20 merged and its API deployed (T21, T22 add kinds) · **Tracker:** 7.13 (proposed) · **Size:** one PR
(split by kind if large)

## Context

API: `GET /v1/me/suggestions`, `POST /v1/me/suggestions/refresh`, accept, dismiss (PR #82);
items carry `kind`, `field`, `current`, `proposed`, `mode` (`fill` | `replace`). The FE plan
(`docs/m7-plan.md` section 15 of the frontend repo) sketches an inbox on the integrations
page and a count in the navigation. The profile-data tab of the import dialog already
renders profile suggestions.

## Goal

The student sees what Gradfolio suggests, why, and accepts or dismisses each item.

## Scope

In:

- A suggestions list on `/integrations` (and a count badge in the navigation) built on the
  API: group by kind (profile, skills, links, project changes); each row shows current value
  next to the proposed one, Accept and Dismiss; `fill` rows are not pre-accepted anywhere.
- States: loading, empty ("Nothing to suggest"), error with Retry, throttled/rate-limit,
  `SUGGESTION_STALE` shown as "this changed meanwhile".
- Notifications: render `suggestions_available` through the existing i18n-key mechanism.
- en/ru/am; keyboard; focus handled after Accept/Dismiss (the T30 lesson: a persistent
  live target); Playwright matrix against the stub; axe clean.

Out: new API work.

## Decisions

Made: nothing is applied without a click. **Levon decides:** whether the navigation shows a
count (default: yes, text plus number, not colour alone).

## Acceptance

Playwright: accept a skill, dismiss a link, see a stale item handled; guards removed (no
auto-accept, stale handling, focus) each fail a named test.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
