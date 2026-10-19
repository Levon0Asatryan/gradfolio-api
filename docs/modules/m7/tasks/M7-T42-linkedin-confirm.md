# M7-T42: LinkedIn confirm

**Repo:** gradfolio-api · **Depends on:** T41 · **Tracker:** 7.8 · **Size:** one PR
**Status:** blocked with T40.

## Context

Confirm is **stateless** (merged plan [§4.3](../plan.md), and
`linkedinConfirmRequestSchema` in `src/api/integrations/dto/linkedin-import.dto.ts`):
`POST /v1/me/imports/linkedin/confirm { experience[], education[], certifications[], skills[] }`
carries the complete items the student selected, possibly edited in the preview. Nothing is
held between preview and confirm, so the server validates every item as if typed by hand. Profile rows: education, experience, certifications, skills
(`src/api/profiles/`; limits and `YYYY-MM`/year validation as in manual entry,
`src/core/validation`). `integrations.linkedin.last_synced_at` is updated.

## Goal

The selected items become profile rows in one transaction, deduplicated; a second identical
import adds nothing. The preview is not trusted: the items are validated again.

## Scope

In: the confirm route as in plan §4.3 (OpenAPI, `http/`, ownership and second-user 404, rate limit);
one transaction; dedupe against existing rows by a normalised key (institution/company +
title + dates); validation as manual entry; the profile limits; `last_synced_at`. Tests
including a barrier race (two confirms of the same preview give one set of rows).
Out: UI (T43).

## Decisions

Made: complete items, not ids (plan §4.3); one transaction. **Levon decides:** nothing.

## Acceptance

First confirm adds the selected items only; the second adds nothing; a malformed or
over-limit item is refused with a stable code and nothing is written; per-section counts
(`added`, `duplicates`) are returned. Guards removed (transaction, dedupe, per-item
validation, ownership) fail named tests.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
