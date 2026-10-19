# M7-T41: LinkedIn ZIP upload, guards and preview

**Repo:** gradfolio-api · **Depends on:** T40 · **Tracker:** 7.7 · **Size:** one PR
**Status:** blocked with T40.

## Context

The ZIP must not pass through the Next.js server (Vercel's request body cap is about 4.5 MB):
it goes by M4's signed upload to a private bucket prefix (`imports/`), and the API reads it
from the bucket and deletes it after the preview or after a TTL. Storage code:
`src/api/storage/` (M4, signed upload). Plan [../plan.md](../plan.md) §4.2 and the endpoint
sketch in `linkedin-import.dto.ts`. Yauzl behaviour was checked in the plan investigation
(declared size visible before inflate; `../`, absolute and backslash paths rejected;
encrypted flag detectable).

## Goal

A student uploads their export and gets a preview; nothing is saved.

## Scope

In:

- Routes in the plan (upload ticket, preview, cancel), rate-limited tighter than imports,
  in `openapi.yaml`, `http/`, with ownership and second-user 404.
- Guards, each with a test and a removal proof: a size cap; a limit on entry count and total
  uncompressed size (ZIP bomb); path-traversal names rejected; CSV only; streamed, never
  extracted to disk; encrypted entries refused; empty and wrong-columns files refused.
- Stable error codes for each refusal. After every outcome the object is deleted from the
  bucket (and no file is left on disk).
- The ZIP corpus as tests: a bomb, traversal, a non-CSV entry, oversized, empty, wrong
  columns.
- A bucket lifecycle rule for `imports/` (age one day) as backstop.

Out: confirm (T42), the UI (T43).

## Decisions

Made: signed upload, delete after use. **Levon decides:** nothing.

## Acceptance

The corpus gives one stable code per case and leaves nothing on disk or in the bucket (shown
by a test against the storage fake and, in the real run, by listing the prefix).

## Needs Levon

Queue M7-T8: the bucket lifecycle (one command, cost $0).

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
