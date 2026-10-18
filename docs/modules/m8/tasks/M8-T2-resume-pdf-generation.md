# M8-T2: Résumé PDF: generation

**Repo:** per the T1 decision (api or fe) · **Depends on:** T1 merged and approved · **Tracker:** 8.1 · **Size:** one PR

## Context

T1 chose the generator and the data fields. Read `pdf-decision.md`.

## Goal

A function or endpoint that returns a résumé PDF for the logged-in user, with the options
T1 defined (which sections to include).

## Scope

In:

- If server-side: `GET /v1/me/resume.pdf?sections=…`, owner-only (it's the caller's own
  data, so there is no id parameter), rate-limited tightly (generation is expensive),
  streamed, with `Content-Disposition` and a safe file name. It's in `openapi.yaml`, has
  a request in `http/`, and a test that another user's data can never appear.
- If frontend: a server-side route handler that fetches the caller's data through the
  existing API client (tokens stay server-side, Q11) and renders the PDF.
- The template from T1, with embedded fonts for Latin, Cyrillic and Armenian.
- User text is rendered as plain text, never as HTML.
- A size and time cap, and a stable error if the data is too large.
- Sections off by the user are absent from the file.

Out: the UI (T3).

## Acceptance

- Tests: the PDF text layer contains the expected name, education and skills (extract
  text from the PDF in the test); a hidden section is absent; an Armenian and a Russian
  profile render real glyphs (check the font is embedded and the text extracts back).
- Another user's data is never in the output (second-user test).
- p95 generation time and memory recorded for a large profile (20 projects).
- Guard proved by removal: the rate limit, and the ownership scoping.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Never write a secret into a file, a PR or a chat.
