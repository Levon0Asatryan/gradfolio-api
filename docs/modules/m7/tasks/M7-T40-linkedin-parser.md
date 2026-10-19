# M7-T40: LinkedIn export: real headers, synthetic fixtures, parser

**Repo:** gradfolio-api · **Depends on:** queue M7-T1 (the real exports) · **Tracker:** 7.6 · **Size:** one PR
**Status:** blocked until the exports exist. **Never start on remembered column names.**

## Context

LinkedIn's API is closed (decision Q8); the only route is the user's own data export
(Settings → Data privacy → Get a copy of your data → the larger archive). The ZIP holds
CSV files; the ones that matter are `Positions.csv`, `Education.csv`, `Skills.csv`,
`Certifications.csv` (and `Profile.csv`). Names and columns may differ by interface
language (en/ru/am). Plan [../plan.md](../plan.md) §4 and its D4 (fixtures approach F1);
the DTO of the planned endpoints is `src/api/integrations/dto/linkedin-import.dto.ts`.
Real exports are personal data: never committed, pasted or attached.

## Goal

A parser written against the real column names, tested on synthetic files with the same
headers.

## Scope

In:

- `scripts/linkedin-export-headers.mjs`: prints only the file names in the ZIP, each CSV's
  header line and an extension count; nothing else (no rows, no names). Run by Levon, or by
  the chat on his machine, on each export.
- Record the real file names and headers (from Levon, Narek and Pargev) in the plan §4.
- Synthetic CSV fixtures with those headers (invented people).
- A pure parser (no I/O beyond reading a stream): positions, education, skills,
  certifications into the preview shape; a column it does not recognise is skipped and
  reported, never guessed; dates parsed per the real format (month names, locale).
- Unit tests, including a header that differs by language.

Out: upload, preview endpoint, confirm.

## Decisions

Made: fixtures F1 (invented rows, real headers). **Levon decides:** nothing beyond sending
the exports.

## Acceptance

- Every column in the plan's table matches a header seen in a real export (list which
  exports, by language, in the PR; no data).
- Guards proved by removal: the unknown-column skip, the date parsing, the header match.
- A grep of the repository finds no real name or address from an export.

## Needs Levon

Queue M7-T1: request the exports; Narek and Pargev send only header lines.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
