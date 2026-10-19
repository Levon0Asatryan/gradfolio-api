# M7-T35: Import dialog wording when the student imports profile data only

**Repo:** gradfolio · **Depends on:** — · **Tracker:** 7.14 · **Size:** one small PR
**Found on production, 2026-10-19:** importing profile data from GitHub ends with "Save as drafts" and a
suggestion to go to projects.

## Context

The dialog (`src/components/github-import/`) is built around repositories: the save button reads
"Save as drafts" (`src/data/locales/en.ts` ~line 251), the result reads "Projects created as drafts:
{count}" with "Publish them from your projects page." (~lines 254-255). When the student ticks only
profile fields (or nothing in the repos tab), those words are wrong and send them to the wrong place.

## Goal

The save button and the result describe what was actually saved.

## Scope

In:

- Save button: "Save as drafts" when repositories are selected, "Update my profile" when only profile
  fields are ticked, "Save" when both (the result lists both).
- Result: projects created (count, draft and where to publish) only when `count > 0`; profile fields
  updated (names of the fields, link to the profile) only when some were accepted; per-item failures
  (already on your profile, stale) listed as today; an empty result never says "created".
- The review step's title and help follow the same rule.
- en/ru/am (no machine copy of an old key left unused: `knip` must pass), unit tests per combination
  (projects only, profile only, both, none), a Playwright check of the profile-only path with axe.

Out: API work; entry points (T34).

## Decisions

Made: wording follows the saved result. **Levon decides:** nothing.

## Acceptance

All four combinations render the right text in en/ru/am; a guard removed (the count condition, the
profile branch) fails a named test.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, cleaning up, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Read every review thread before you
report, and report "reviewed" only for the exact head Codex reviewed. Never write a secret,
a token or real user data into a file, a PR or a chat.
