# M8-T5: Email: mailer module, outbox, sender job

**Repo:** gradfolio-api · **Depends on:** — (runs against a fake provider) · **Tracker:** 8.6 · **Size:** one or two PRs

## Context

The API writes notifications in the same transaction as the event that causes them (M5).
Email must follow the same rule, and must never be sent inside a transaction or twice.
Look at `src/api/notifications` and `src/api/team/services/team-write.service.ts` for the
pattern, `src/core/storage/sweep*.ts` and `docs/ops/deploy.md` for how a CLI becomes a Cloud
Run job, and `src/core/config/schema.ts` for the validated config.

## Goal

The email infrastructure, provider-independent: any module can queue an email in its own
transaction, and a job sends queued emails after commit.

## Scope

In:

- Migration: an `email_outbox` table (id, recipient user id and the address at queue
  time, template key, locale, JSON params, status `pending|sending|sent|failed|skipped`,
  attempts, next-attempt time, provider message id, last error without secrets,
  timestamps, and a unique idempotency key). Additive and safe while the previous
  revision serves; applied twice leaves nothing; `down` then `up` gives the same schema.
- A `mailer` module behind an interface (`EmailProvider.send`), a fake provider that
  records messages for tests, and a log-only provider for local development. Nothing
  provider-specific here (T6).
- `OutboxService.enqueue(tx, message)`: inside the caller's transaction. A rolled-back
  transaction leaves no email (prove it).
- A sender CLI/job (`npm run email:send`): claims pending rows safely (so two runs can't
  send the same row, proved under a barrier), sends, records the result, retries with
  backoff up to N attempts, and marks `failed` after that. A row is sent at most once:
  the provider call carries the row's idempotency key.
- Template rendering for a key and a locale (en/ru/am), with a plain-text part, HTML
  escaped, and a link builder that only produces links to our own frontend host.
- No email address or token in logs (extend the redaction list) or in error messages.
- Config: `EMAIL_PROVIDER` (`fake|log|<provider>`), the from address, the frontend base
  URL for links. Production without a real provider configured doesn't send and doesn't
  fail the app.

Out: the provider adapter (T6), the invite template (T8), preferences (T7).

## Acceptance

- Unit and integration tests; coverage ≥ 90%; fresh clone passes verify and `test:int`.
- Guards proved by removal: the transaction coupling, the claim (double send), the
  retry cap, the HTML escaping, the link host check.
- Everything in `openapi.yaml` that changed, if any; `docs/ops/deploy.md` gains a section on
  the job (how to run it, how to see failed rows).

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Never write a secret into a file, a PR or a chat.
