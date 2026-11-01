# M8-T20: Email worker: create the Cloud Run job

**Repo:** gradfolio-api, ops · **Depends on:** queue M8-T11 (the way it runs, and cost approval) · **Tracker:** 8.6 · **Size:** one docs/ops PR plus the commands

## Context

The code, the three secrets and the signed webhook are live (audit). There is no job:
`gcloud run jobs list` shows only `gradfolio-migrate`, and the Cloud Scheduler API is not
enabled. Steps 3 and 5 of [../sendgrid-handoff.md](../sendgrid-handoff.md) are this task.

## Goal

`gradfolio-email-worker` exists, runs the image that is deployed, and does nothing harmful.

## Scope

In:

- The way the worker runs, as chosen in queue M8-T11 (by hand or on demand after an invite,
  a GitHub Actions cron, or Cloud Scheduler). Show the monthly cost from the live pricing
  pages before creating anything billed. No schedule is created without Levon's OK.
- Create the job from the exact commands in `docs/ops/deploy.md`: same image SHA as the API,
  `EMAIL_PROVIDER=sendgrid`, `EMAIL_FROM` the verified Single Sender, the frontend origin,
  `EMAIL_DELIVERY_ENABLED=false`, one task, parallelism 1, max retries 0. Grants: the worker
  identity gets the database URL, the sending key and the unsubscribe secret; the API identity
  already has the webhook key.
- Run it once. Expected result: `{"processed":0,"disabled":true}`.
- If GitHub Actions deploys the job image on each release, set the repository variable
  `GCP_EMAIL_JOB`; check the deploy workflow still passes.
- gcloud only through the sandbox: `CLOUDSDK_CONFIG` must be
  `/Users/levon/Dev/university/.sandbox/gcloud`. No key files.

Out: turning delivery on (T21).

## Acceptance

- `gcloud run jobs describe gradfolio-email-worker` (output with no secret values) is in the PR.
- One execution succeeded with delivery off, and the log has no address, token or key.
- The cost is recorded in `docs/ops/deploy.md`.

## Needs Levon

Queue M8-T11: the choice and the approval.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
The audit that opened this task is [../audit-2026-11-01.md](../audit-2026-11-01.md). Report in the PR
body (`docs/process/handoff-template.md` part 2). Do not merge. Never write a secret into a
file, a PR or a chat.
