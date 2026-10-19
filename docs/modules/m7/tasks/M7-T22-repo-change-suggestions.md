# M7-T22: Repo-change suggestions and a notification (d2)

**Repo:** gradfolio-api · **Depends on:** T20 · **Tracker:** 7.13 (proposed) · **Size:** one PR (split if large)

## Context

Imported projects store a snapshot of what GitHub gave (`github-import` repository, hashes
per field, `src/api/integrations/utils/github-fields.ts`); re-sync (`github-sync.service.ts`)
never overwrites a field the student edited. Suggestions: see
[M7-T20](M7-T20-skill-suggestions.md). Notifications: the `notifications` table
(M5; `src/api/notifications/`) with an i18n key and params, the frontend renders the text.
Design: [../plan.md](../plan.md) §6.

## Goal

When a repository changes upstream, the student is told once and offered a suggestion to
update the project, never overwritten.

## Scope

In:

- Kind `project.new`: a repository not imported yet (accept = import as draft, reusing the
  import service).
- Kind `project.update`: README or description changed upstream since the snapshot (accept
  applies only a field that still equals the snapshot; `409 SUGGESTION_STALE` if the
  student edited it since).
- Stars and forks stay silent (decision D8: refreshed on re-sync, no suggestion).
- One notification per refresh batch, not per suggestion: new `notifications.type`
  `suggestions_available`, params `{count, kinds}`. This needs an **additive migration**
  (take the next free number on the latest `main`; M8 adds migrations too). Applied twice
  leaves nothing; `down` then `up` is identical.
- Lazy polling on refresh as today, no scheduler. Conditional requests (ETag) where
  GitHub supports them.
- OpenAPI, `http/`, tests with a fake GitHub, ownership and second-user 404, barrier tests
  for a refresh racing a re-sync or a disconnect.

Out: UI (T32).

## Decisions

Made: no silent overwrite; one notification per batch. **Levon decides:** nothing.

## Acceptance

- Changing a README upstream (in the fake) then refreshing yields one suggestion and one
  notification; refreshing again yields none; an edited description is not touched.
- Accepting after the student edited the field gives `SUGGESTION_STALE`.
- Guards proved by removal: snapshot comparison, one-per-batch, ownership.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
