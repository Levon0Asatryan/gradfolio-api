# M8-T6: Email: provider adapter and production sending

**Repo:** gradfolio-api, plus ops · **Depends on:** T4 approved by Levon, T5 merged · **Tracker:** 8.6 · **Size:** one PR plus ops steps

## Context

T4 chose a provider and a domain. T5 built the outbox and a fake provider. Read both.

## Goal

Real email leaves the system, safely, from the chosen domain.

## Scope

In:

- The provider adapter implementing `EmailProvider`, with the idempotency key, timeouts,
  and error classification (retry on 5xx and 429, fail on 4xx).
- Bounce and complaint webhooks (if T4 chose a provider that has them): a verified
  signature, an endpoint that records the result, and `skipped` for any later email to an
  address that bounced or complained. Rate-limited, and in `openapi.yaml`.
- The scheduled run: a Cloud Run job (same image) triggered every few minutes by Cloud
  Scheduler, and the exact `gcloud` commands in `docs/ops/deploy.md`. Show the monthly cost
  before creating anything billed.
- The API key in Secret Manager, mounted as an env var; rotation steps in `docs/ops/deploy.md`.
- A staging check: send one email to a test address from a one-off job run.

Out: the invite template (T8).

## Needs Levon

- Creating the provider account, adding the DNS records, and putting the API key into
  Secret Manager (steps from T4).
- Approval before any billed resource (Scheduler job).
- gcloud only through the university sandbox: `CLOUDSDK_CONFIG` must be
  `/Users/levon/Dev/university/.sandbox/gcloud` (check it as in `docs/ops/deploy.md`);
  never create a key file.

## Acceptance

- Adapter tests against a stubbed HTTP server (no real provider in CI): success, retry,
  permanent failure, webhook signature accepted and rejected.
- One real email delivered to a test mailbox, headers checked: SPF and DKIM pass, the
  from address is right. The evidence is in the PR with the address redacted.
- The job is idempotent: running it twice sends nothing twice.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Never write a secret into a file, a PR or a chat.
