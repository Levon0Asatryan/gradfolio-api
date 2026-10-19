# M7-T31: Import entry points: after connect, Projects → Add

**Repo:** gradfolio · **Depends on:** — · **Tracker:** 7.14 (proposed) · **Size:** one PR

## Context

The import dialog exists (`src/components/github-import/`, PRs #109, #111, #123): repos tab,
profile-data tab, review with edits, save as drafts, result. It opens today only from the
GitHub card on `/integrations`. Levon's spec:
[../../../process/handoffs/m7/import-addendum.md](../../../process/handoffs/m7/import-addendum.md)
§1 and §3. The connect callback is `src/app/integrations/github/callback/route.ts`; the
return target is a closed list in an HttpOnly cookie (`gh_link_return`).

## Goal

The same dialog opens right after GitHub connects, and from Projects → Add.

## Scope

In:

- After a successful connect, the callback returns with a hint (e.g. `?github=connected&import=1`)
  and the page opens the dialog **only if** the API says GitHub is connected (a forged
  parameter opens nothing). "Not now" closes it and imports nothing.
- Projects → Add: when GitHub is connected, two choices ("Create manually" is today's form,
  "Import from GitHub" opens the dialog on the repos tab); when it is not, the form directly
  with a small "Connect GitHub to import repos" link.
- Focus returns to the trigger; keyboard operable; en/ru/am.
- Playwright against the stub: connect → dialog → review → save; the forged-parameter case.

Out: changes to the dialog's internals.

## Decisions

Made: one shared dialog component everywhere; nothing is imported without a click.
**Levon decides:** nothing.

## Acceptance

- The Playwright matrix (390/1440, light/dark, en/ru/am) passes for the new states; axe 0
  serious or critical; no console errors, hydration warnings or layout shift.
- Guards removed (status check before opening, the closed return list, no import without a
  click) each fail a named test.

## Needs Levon

The real path on production is part of M7-T50 (queue M7-T4/T6).

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
