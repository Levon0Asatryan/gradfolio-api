# M8-T1: Résumé PDF: generator spike and decision

**Repo:** gradfolio-api (docs PR) · **Depends on:** — · **Tracker:** 8.1 · **Size:** one docs PR

## Context

The tracker says: pick the generator, on the frontend (for example `@react-pdf/renderer`)
or on the server; one template in v1; choose which sections go in. Nothing exists yet.
Students write in English, Russian and Armenian, so **fonts decide the choice**: the PDF
must render Armenian and Cyrillic, not boxes. The API runs on Cloud Run (a headless
browser needs memory and cold-start time); the frontend runs on Vercel (serverless limits
on size and time).

## Goal

A decision document `docs/modules/m8/pdf-decision.md` that Levon approves, so T2 and T3
build the right thing.

## Scope

In:

- Run, don't recall: build the same small résumé (header, education, experience, skills,
  two projects; one test in each language) with each candidate, and compare:
  1. `@react-pdf/renderer` (in the frontend, client or server)
  2. A server-side library such as `pdfmake` or `pdf-lib` (in the API)
  3. A headless browser rendering HTML (Playwright or Puppeteer on Cloud Run)
- Measure and record: output quality for en/ru/am, file size, time to generate, memory,
  cold start, bundle or image-size impact, accessibility of the PDF (real text, tab
  order), and what it costs on Cloud Run or Vercel.
- Fonts: which font covers Latin, Cyrillic and Armenian with an open license (Noto Sans
  / Noto Sans Armenian are already in the app); how it's embedded.
- Data: the résumé uses only the caller's own data from the existing profile API. List
  the fields and what's excluded (never birthday, phone, or private contact details
  unless the user opts in).
- Sections the user can switch on or off, and the one v1 template (layout sketch).
- A recommendation with the reason.

Out: the real implementation (T2, T3).

## Needs Levon

**Levon decides** the generator and the section list. Stop after the PR.

## Acceptance

- The document has the measured comparison table, with the sample PDFs attached to the
  PR (small, synthetic data only, no real person's data).
- The recommendation says which of T2/T3 is API or frontend work.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Never write a secret into a file, a PR or a chat.
