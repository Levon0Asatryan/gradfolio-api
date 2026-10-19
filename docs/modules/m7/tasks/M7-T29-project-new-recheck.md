# M7-T29: Accepting a `project.new` suggestion must re-check the repository

**Repo:** gradfolio-api · **Depends on:** — · **Tracker:** 7.13 · **Size:** one small PR
**Source:** an unanswered Codex P2 on PR #105 (M7-T22), merged open.

## Context

`src/api/suggestions/services/project-suggestions.service.ts` (~line 196): accepting a `project.new`
suggestion calls `GithubImportService.import`, which permits archived repositories and repositories
where the caller only has push access. A `project.new` suggestion is only **offered** for a repository
that is owned, public, non-fork and non-archived, and a refresh drops it when that stops being true.
So if the repository is archived or transferred between the offer and the accept, the accept still
creates the draft, and the two paths disagree.

## Goal

Accept creates a draft only for a repository that still qualifies.

## Scope

In: re-check the freshly fetched repository against the same eligibility predicate that decides the
offer (extract one predicate, used by both) and answer `409 SUGGESTION_STALE` when it no longer
qualifies, marking the suggestion `superseded`. Tests with the fake GitHub: archived after offer,
transferred (owner changed), made private, deleted; a barrier test for a refresh racing the accept;
guard removal (the re-check, the shared predicate). OpenAPI text for the 409, `http/`.
Out: UI.

## Decisions

Made: one predicate for offer, refresh and accept. **Levon decides:** nothing.

## Acceptance

Each disqualifying change gives `SUGGESTION_STALE` and no project row; a still-qualifying repository
still imports as a draft.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, cleaning up, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
Report in the PR body, in the format from `docs/process/handoff-template.md` part 2. Do not
merge. Read every review thread before you report, and report "reviewed" only for the exact
head Codex reviewed. Never write a secret, a token or real user data into a file, a PR or a chat.
