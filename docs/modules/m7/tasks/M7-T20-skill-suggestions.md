# M7-T20: Skill suggestions from GitHub and from the student's own projects

**Repo:** gradfolio-api · **Depends on:** — · **Tracker:** 7.13 (proposed) · **Size:** one PR
**Status:** in progress. A previous chat left uncommitted work in the worktree
`gradfolio-api-m7` on branch `m7/skill-suggestions` (`profiles.module.ts`,
`skills.service.ts`). The module chat hands it over; review it, do not trust it.

## Context

Suggestions exist (PR #82, migration 0009): table `suggestions` with
`UNIQUE (user_id, dedupe_key)`, states open/accepted/dismissed/superseded, routes
`POST /v1/me/suggestions/refresh`, `GET /v1/me/suggestions`, `POST …/{id}/accept` and
`/dismiss`. Code: `src/api/suggestions/` (`suggestions.service.ts`, `services/profile-rules.ts`,
`repositories/suggestion.repository.ts`, `dto/suggestion.dto.ts`). Today's kinds are
`profile.<field>` (GitHub profile) and the LinkedIn sign-in ones. Design:
[../plan.md](../plan.md) §6. GitHub is reached with the identity-provider token Auth0
holds (`src/core/github/`, nothing stored). Skills, technologies and tags are one
case-insensitive namespace (`user_skills`, `project_technologies`, `terms`; see CLAUDE.md
"Facts every chat must know": use `setUserSkills`, never `JSON_CONTAINS`).

## Goal

The student is offered skills they probably have but have not listed, as suggestions they
accept or dismiss one at a time, never added silently.

## Scope

In:

- New kind `skill.add`. Two sources: (1) languages and topics of the student's own
  public repositories (already in the repo objects the refresh reads; per-repo
  `GET /repos/{o}/{r}/languages` only for the N most recent repos, N configurable, default
  small); (2) technologies of the student's own projects that are missing from their skills.
- Offer a skill only when it is missing from the profile (case-insensitive) and appears in
  **at least two** repositories or projects. The threshold is a constant with a test.
- `dedupe_key` per skill (normalised); a dismissed skill does not return unless the
  evidence changes. Accept = `setUserSkills` with the usual validation and limit
  (`PROFILE_MAX_SKILLS`), in one transaction, `409 SUGGESTION_STALE` if it is already there.
- OpenAPI, `http/suggestions.http`, unit tests for the rules, integration tests with a fake
  GitHub over real HTTP, ownership and second-user 404.

Out: links (T21), repo-change suggestions (T22), the UI (T32).

## Decisions

Made: suggestions only, never silent (Levon, 2026-10-18); no new GitHub scope; public data only.
**Levon decides:** nothing.

## Acceptance

- A student with three repos using TypeScript and no TypeScript skill gets one `skill.add`;
  with one repo, none. Accepting adds the skill; dismissing hides it; a second refresh does
  not re-offer a dismissed one.
- Rate cost of one refresh is stated in the PR (calls per refresh, with the cap on
  `/languages`).
- Guards proved by removal: the threshold, the case-insensitive missing check, the per-repo
  cap, ownership.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
