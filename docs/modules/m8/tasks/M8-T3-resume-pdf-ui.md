# M8-T3: Résumé PDF: download UI

**Repo:** gradfolio · **Depends on:** T2 merged and deployed (API case) · **Tracker:** 8.1 · **Size:** one PR

## Context

The profile page (`src/app/profile/page.tsx`) and the Account page are where a student
would look for this. UI rules: palette C, labelled controls, dialogs with Save/Cancel,
toasts, every string in en/ru/am (the dictionary type enforces it), calls server-side only.

## Goal

A "Download résumé (PDF)" action with section checkboxes.

## Scope

In:

- Entry points: a button on the profile page (own profile only) and in the Account page.
- A small dialog: sections to include (the list from T1), a preview of the file name,
  "Download". Loading, error (including the rate limit) and empty-profile states: an
  empty profile says what to fill in first.
- The download works with the keyboard, and the dialog traps and returns focus.
- Every string in en/ru/am.

Out: the generation (T2).

## Acceptance

- `npm run verify`, coverage and build.
- Playwright (browsers in `PLAYWRIGHT_BROWSERS_PATH=/Users/levon/Dev/university/.sandbox/ms-playwright`):
  390 and 1440, light/dark, en/ru/am; axe with 0 serious or critical; clean console;
  keyboard walkthrough of the dialog.
- A real download on the deployed site by the task owner, opened and checked in all
  three languages.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Never write a secret into a file, a PR or a chat.
