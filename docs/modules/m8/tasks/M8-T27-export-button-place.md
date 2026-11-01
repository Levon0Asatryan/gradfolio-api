# M8-T27: Move the résumé export button

**Repo:** gradfolio · **Depends on:** — · **Tracker:** 8.1 · **Size:** one small PR

## Context

Today `ResumeDownload` (`src/components/profile/ResumeDownload.tsx`) renders as a lone button at
the very top of the owner's profile page, above the owner hint and the completeness card
(`ProfileView.tsx`, line 43: `{owner && <ResumeDownload profile={profile} />}`). It opens a dialog
with the sections, the projects and the language. Levon wants it somewhere else (2026-11-01). The
place was not named, so the first step is a proposal.

## Goal

The export is where a student expects to find it, and the profile page has one clear row of
owner actions.

## Scope

In:

- **Propose the place, with a screenshot of each option, and stop. Levon decides.** Options:
  1. In the profile header's action row, next to "Edit profile", as "Export résumé (PDF)". The
     owner sees all profile actions in one place. **Recommended.**
  2. A "Résumé" section on the Account page: it is about the student's data, and out of the way
     of the profile.
  3. Both: the header action opens the dialog; Account links to it.
  4. A button that later opens the CV builder (T28), so the placement should be chosen with it.
- Implement the chosen option. The dialog and its behaviour do not change.
- On a phone (390 px) the control is reachable with one thumb and has a 44 px target; the label
  is the visible text, not only an icon.
- Every string in en/ru/am; the focus returns to the control after the dialog closes.
- Only the owner sees it (the API still decides: another user gets 404).

Out: the dialog contents, the PDF (T23), the CV builder (T28).

## Acceptance

- `npm run verify`, coverage and build.
- Playwright (browsers in `PLAYWRIGHT_BROWSERS_PATH=/Users/levon/Dev/university/.sandbox/ms-playwright`):
  390 and 1440, light and dark, en/ru/am; axe with 0 serious or critical; a keyboard walkthrough
  to the control and through the dialog. These results also close the profile part of T24.
- A visitor's view of the same profile has no control.

## Needs Levon

The choice of the place.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
Report in the PR body (`docs/process/handoff-template.md` part 2). Do not merge. Never write a
secret into a file, a PR or a chat.
