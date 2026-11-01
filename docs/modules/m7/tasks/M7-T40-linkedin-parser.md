# M7-T40: LinkedIn export: real headers, synthetic fixtures, parser

**Repo:** gradfolio-api · **Depends on:** queue M7-T1 (the real exports) · **Tracker:** 7.6 · **Size:** one PR
**Status:** ready on **provisional** headers (decision of Levon, 2026-11-01): the table in [../linkedin-export-guide.md](../linkedin-export-guide.md) comes from a public export sample, not a real archive. Levon requested his own export on 2026-11-01; when it arrives the real header lines replace the provisional ones. Never start on remembered column names: use only that table.

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
- Record the headers in the plan §4, each marked *provisional* until a real export confirms it (Levon, Narek, Pargev send header lines; the script prints them).
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

- The parser matches the provisional table; the PR lists which columns are still unconfirmed
  by a real export. Header matching is tolerant: a different language or order is reported as
  unrecognised, never guessed. Real-export confirmation is T51.
- Guards proved by removal: the unknown-column skip, the date parsing, the header match.
- A grep of the repository finds no real name or address from an export.

## Needs Levon

Queue M7-T1: real header lines (Levon's export is requested). Not a blocker for this task.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
