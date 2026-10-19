# M7-T34: Offer the import after every successful connect, and keep offering it

**Repo:** gradfolio · **Depends on:** — · **Tracker:** 7.14 · **Size:** one PR
**Found on production, 2026-10-19:** "after connecting an integration it should suggest importing
data; now it just connects, the user might skip the import".

## Context

M7-T31 (#130) opens the import dialog after the connect **callback** (`?github=connected&import=1`).
But `GithubCard.connect()` (`src/components/integrations/GithubCard.tsx`) has a second success
path: `startGithubConnectAction` answers `state: "connected"` at once (the account was already
linked, for example after signing in with GitHub), and the card only shows the toast and refreshes.
No dialog opens on that path, and nothing remembers that the student has not imported anything.
Levon's spec: `docs/process/handoffs/m7/import-addendum.md` §1 (nothing imported without a click).

## Goal

Every route to "GitHub is connected" ends with the import offered, and a student who skips it is
reminded without being nagged.

## Scope

In:

- Open the import dialog in the immediate-connected path too (same component and rules as the
  callback path: only when the API says connected, "Not now" imports nothing).
- A standing prompt on `/integrations` (and on the onboarding step) while GitHub is connected and
  the student has **no project with `source: github`**: a short card ("Bring your repositories and
  profile details from GitHub") with an "Import from GitHub" button. The data is the existing
  `GET /v1/me/projects` (`source`). A dismiss ("Not now") is remembered in the browser for that
  viewer (`localStorage`, wrapped in try/catch; the page works without it).
- LinkedIn gets the same shape later (T43); do not build it now, but keep the component generic.
- en/ru/am, keyboard, focus returns to the trigger, Playwright against the stub: connected at
  once then dialog; connected with zero imports then the prompt; dismissed then gone after reload;
  a forged state opens nothing.

Out: API work; the dialog's internals (T35 changes its wording).

## Decisions

Made: nothing is imported without a click. **Levon decides:** whether the prompt also appears on
the dashboard (default: no, integrations page and onboarding only).

## Acceptance

Matrix 390/1440, light/dark, en/ru/am; axe 0 serious or critical; guards removed (API-connected
check, dismissal, zero-import condition) fail named tests.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, cleaning up, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Read every review thread before you
report, and report "reviewed" only for the exact head Codex reviewed. Never write a secret,
a token or real user data into a file, a PR or a chat.
