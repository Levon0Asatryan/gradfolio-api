# M8-T24: Browser checks for the PDF dialog, Settings and unsubscribe

**Repo:** gradfolio · **Depends on:** — · **Tracker:** 8.1, 8.8 · **Size:** one PR

## Context

The UI is live and was checked by hand, but T3 and T9 required a Playwright matrix with axe and
a keyboard walkthrough, and the frontend record has none (audit).

## Goal

The PDF dialog, the Settings email section and the unsubscribe page are checked in the browser
and covered by CI.

## Scope

In (browsers in `PLAYWRIGHT_BROWSERS_PATH=/Users/levon/Dev/university/.sandbox/ms-playwright`):

- 390 and 1440, light and dark, en/ru/am: axe with 0 serious or critical, a clean console, no
  layout shift.
- A keyboard walkthrough of the PDF dialog (focus in, Escape, focus returns) and the Settings
  email controls.
- The unsubscribe page with a valid, an expired and a missing token, without a login (CI,
  against the stubbed API).
- The results in `docs/m8-verification.md` of this repo. Specs that need a login stay out of CI;
  they use a headed login by Levon as a queue row if wanted.

## Acceptance

`npm run verify`, the e2e suite and the build pass; the matrix results are recorded.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
The audit that opened this task is [../audit-2026-11-01.md](../audit-2026-11-01.md). Report in the PR
body (`docs/process/handoff-template.md` part 2). Do not merge. Never write a secret into a
file, a PR or a chat.
