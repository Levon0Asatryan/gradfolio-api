# M8-T9: Settings: email preferences and language (FE)

**Repo:** gradfolio · **Depends on:** T7 merged and deployed · **Tracker:** 8.8 · **Size:** one PR

## Context

`src/app/settings/page.tsx` and `src/components/settings/SettingsPage.tsx` hold the UI
language and theme (stored in the browser). T7 adds a stored preferred language and a
`team_invites` preference to `/v1/me`. M7 may be editing the Settings page, the locales or
`src/lib/api/client.ts` in an open PR: rebase after it merges.

## Goal

The user controls their email settings, and their language is saved on the account.

## Scope

In:

- A new "Email" section on Settings: a switch "Email me when I'm invited to a project",
  and the preferred language for emails (follows the UI language by default; saving the UI
  language also saves it on the account when logged in).
- Saves through a server action using the M2 API client and the generated types
  (bump the pinned API contract). Success toast; errors keep the previous value.
- The unsubscribe page `/unsubscribe?token=…`: a server-rendered page that calls the
  token endpoint and says what happened ("You will no longer get invite emails"), with a
  link to Settings. No login required, no token echoed back into the page, `noindex`.
- Every string in en/ru/am.

## Acceptance

- `npm run verify`, coverage and build.
- Playwright: 390 and 1440, light/dark, en/ru/am; axe 0 serious or critical; clean console;
  keyboard walkthrough; the unsubscribe page with a valid, an expired and a missing token.
- A real run (queue row for the logged-in part): change the preference on production and
  see it on `/v1/me`.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Never write a secret into a file, a PR or a chat.
