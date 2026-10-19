# M7-T51: Real LinkedIn run on production

**Repos:** gradfolio-api, gradfolio · **Depends on:** T43 deployed, queue M7-T1 · **Tracker:** 7.6–7.9 · **Size:** a run and a record
**Status:** blocked with T40.

## Context

As [M7-T50](M7-T50-github-real-run.md), for the LinkedIn half of the exit. The real export
is personal data and stays on Levon's machine.

## Goal

A real export previews correctly, confirming adds only the selected items, and a second
import adds nothing.

## Scope

In: upload the real ZIP in the wizard, check the preview against the export, confirm a
subset, check the profile, import again (nothing added), upload a malformed and an oversized
file (stable codes), list the bucket prefix (empty). Record counts and codes only, never
content. Write the LinkedIn half of `verification.md`.

## Acceptance

The exit lines for LinkedIn, each with the request and result.

## Needs Levon

Queue M7-T5.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
