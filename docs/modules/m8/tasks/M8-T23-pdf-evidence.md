# M8-T23: Résumé PDF evidence

**Repo:** gradfolio-api · **Depends on:** — · **Tracker:** 8.1 · **Size:** one PR

## Context

The PDF is live and works, but the T1 and T2 briefs asked for evidence that was not recorded
(audit): a measured generator comparison, p95 time and memory for a large profile, and guard
removal for the rate limit and the ownership scoping.

## Goal

The evidence exists, so the decision and the limits can be defended.

## Scope

In:

- `docs/modules/m8/pdf-decision.md`: a short, honest record. PDFKit was chosen. State why (fonts
  for Armenian, Cyrillic, Latin; no browser on Cloud Run; size). Measure PDFKit and one
  alternative (for example `pdf-lib`) on the same sample, and say plainly if the comparison
  was made after the fact.
- p95 generation time and peak memory for a 20-project profile in en, ru and hy, on the
  production image locally; compare with the Cloud Run memory setting.
- Guard proofs by removal, each failing a named test: the PDF rate-limit budget, and the
  scoping that keeps another user's data out of a file.
- Synthetic data only.

## Acceptance

The document and the proofs are in the PR; no limit or test is weakened.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
The audit that opened this task is [../audit-2026-11-01.md](../audit-2026-11-01.md). Report in the PR
body (`docs/process/handoff-template.md` part 2). Do not merge. Never write a secret into a
file, a PR or a chat.
