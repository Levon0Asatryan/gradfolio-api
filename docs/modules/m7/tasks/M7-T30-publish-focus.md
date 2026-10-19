# M7-T30: Focus and announcement after Publish on cards and the project page

**Repo:** gradfolio · **Depends on:** — · **Tracker:** 7.14 (proposed) · **Size:** one PR
**Status:** in progress. A previous chat has a local, unpushed commit `ded577f` on
`m7/publish-status` in the worktree `gradfolio-m7` ("focus and announcement outlive the
Publish button on cards and the project page"). Review it before reuse.

## Context

PR #121 added the Draft chip and a quick Publish (`PublishButton`) and merged with one
unresolved Codex P2 (`src/app/projects/ProjectsContent.tsx:150`): after Publish succeeds
on `/projects`, the card flips `isDraft`, which unmounts the whole `PublishButton` while its
confirmation dialog holds focus. Focus lands on removed DOM and the success Snackbar (also a
descendant) disappears, so nothing is announced. `ImportResult.tsx` already has the fix
(a `role="status"` line that takes focus).

## Goal

After a successful Publish, keyboard focus is on a stable element and the result is announced.

## Scope

In: the card (`src/components/projects/ProjectCard.tsx`, the feed in `ProjectsContent.tsx`)
and the project page header. A persistent live target that outlives the button and a
focus move before unmounting. A render test (focus on a connected element, the status text
announced) and a keyboard path in Playwright; en/ru/am text.
Out: other pages.

## Decisions

Made: same pattern as `ImportResult`. **Levon decides:** nothing.

## Acceptance

- Playwright keyboard walkthrough: open Publish, confirm with Enter, focus is on the status
  element and its text is in the accessibility tree; axe 0 serious or critical.
- Guard removed (the focus move) fails a named test.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
