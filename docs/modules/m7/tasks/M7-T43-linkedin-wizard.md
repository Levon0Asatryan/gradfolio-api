# M7-T43: LinkedIn import wizard

**Repo:** gradfolio · **Depends on:** T41 and T42 merged and deployed · **Tracker:** 7.9 · **Size:** one PR
**Status:** blocked with T40.

## Context

FE plan section for the wizard: four steps (instructions, upload, review, done). The export
arrives later by email, so the instructions say so and the wait never blocks onboarding.
The ZIP is PUT directly to the signed URL (M4's `UploadControl` pattern), never through
Next. The preview is not held by the server: confirm sends the complete selected items, possibly edited (plan §4.3). The wizard lives in the onboarding stepper (`/integrations/connections`) and on
`/integrations`. API calls are server-side only (Q11) except that PUT. The LinkedIn card is
status-only today (`src/components/integrations/LinkedinCard.tsx`).

## Goal

A student downloads their export, uploads it, picks the items and confirms.

## Scope

In: the four steps; upload with progress; per-section and per-item checkboxes, duplicates
and problem items disabled; a result screen; instructions with screenshots described per
language (the images come from queue M7-T7; the wizard ships without them if late); all
strings in en/ru/am; keyboard walkthrough; Playwright with synthetic ZIPs against the stub;
the Playwright matrix and axe.
Out: API work.

## Decisions

Made: the preview stays in the browser's memory only; confirm sends the selected items, as plan §4.3 and the DTO say (the FE plan's "ids" proposal is superseded). **Levon decides:** nothing.

## Acceptance

The matrix passes (390/1440, light/dark, en/ru/am); guards removed (no confirm without a
selection, disabled duplicates, no secrets in the browser) fail named tests.

## Needs Levon

Queue M7-T7: capture and redact the screenshots.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
