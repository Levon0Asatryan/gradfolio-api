# M8 invitation email operations

The outbox, preferences, localized templates and worker are implemented locally.
**Production delivery is disabled.** The user has not chosen a provider or sending
domain (2026-10-20). Do not interpret a saved invitation or preference as a sent
email. In-app team notifications continue independently of mail delivery.

## Current behavior

- A registered invitee with a verified account email and enabled preference gets
  an outbox row in the invitation transaction. The public contact email is never
  used. The `verified` profile badge is not used as email verification.
- Account email and its verification refresh together from explicit Auth0 claims.
  Existing accounts start unverified for email delivery until an authenticated
  request supplies those claims. A token without them does not clear known state.
- Invitations reserve at most one email per project/invitee in a rolling 24 hours.
  Re-invitation after rejection can queue a new email after that cooldown.
- Answering/removing an invitation cancels its queued work. Before sending, the
  worker rechecks preference, email, suppression and pending membership. Pending
  work is removed with its recipient account or project. Already dispatched
  messages cannot be recalled.
- The stored language is `en`, `ru` or `am` (Armenian HTML uses `hy`). Email content
  is a bounded snapshot of the inviter's name and project title, with escaped HTML
  and a plain-text alternative. The action opens `/teams` and requires login.
- An unsubscribe link carries a purpose-specific signed token in the URL fragment.
  GET renders confirmation, clears the fragment and makes no preference change.
  POST disables invitation email. Tokens expire; repeat POSTs are harmless.

## Run the worker

Use the application's normal environment, with `EMAIL_DELIVERY_ENABLED=false`:

```sh
npm run email:work
# Built image / future Cloud Run job:
node dist/core/email/cli.js
```

The disabled worker reports `{"processed":0,"disabled":true}` and performs only
retention cleanup. `EMAIL_DELIVERY_ENABLED=true` currently makes the CLI fail with
an explicit “No production mailer is configured” error. Tests inject a fake mailer
directly into `EmailWorker`; no real inbox is contacted.

The worker claims rows with `FOR UPDATE SKIP LOCKED` and a lease, commits, then
sends. Provider requests have a timeout shorter than the lease. Each attempt uses
the same row ID as delivery key and deterministic content. Known non-acceptance
may retry with backoff/jitter, bounded by attempt count and invitation age.
Unknown delivery outcomes become `uncertain`. An expired claim is retried only
inside the injected provider's advertised idempotency window; otherwise it also
becomes `uncertain`. The account email's hash binds retries to one destination.

## Connect a provider later

1. Choose and verify a sending domain and a provider. Confirm SPF/DKIM/DMARC,
   allowed sender, region, cost, timeout and bounce/complaint support. Record the
   provider's deduplication window and behavior for the same key and payload.
2. Implement `src/core/email/mailer.ts` for that provider, honoring its AbortSignal.
   The adapter returns a bounded provider message ID. Raise `MailDeliveryError`
   only when the response establishes non-acceptance; a timeout or ambiguous
   response must remain an unknown outcome. Never log message payloads, recipient
   addresses, credentials, unsubscribe tokens or raw provider response bodies.
3. Wire the adapter into the worker CLI. Add a provider-specific webhook adapter
   that verifies signatures and correlates the row ID/message ID before calling
   `EmailWorker.recordFeedback`. There is deliberately no unsigned webhook route.
   Duplicate feedback is harmless; a bounce for an old address must not suppress
   a new account email.
4. Supply `EMAIL_PUBLIC_URL` as the frontend origin and a random
   `EMAIL_UNSUBSCRIBE_SECRET` of at least 32 characters through Secret Manager.
   Set provider credentials only in the worker/webhook runtime. Rotating the
   unsubscribe secret invalidates links signed with the previous secret.
5. Use the API image for a Cloud Run job, command above, with Cloud SQL networking
   and DML-only DB access, a small pool, one task and bounded execution time. A
   scheduler may start it periodically; DB leases also protect overlapping runs.
   Enable delivery only after a real test-inbox send, duplicate/crash recovery,
   signed bounce/complaint and unsubscribe smoke test pass.

## Inspect failures

Inspect IDs and categories, excluding personal data:

```sql
SELECT id, status, attempts, failure_code, next_attempt_at, created_at
FROM email_outbox
WHERE status IN ('failed', 'uncertain', 'bounced', 'complained')
ORDER BY created_at DESC;
```

`uncertain` is never blindly requeued. Reconcile it with the provider using the
same delivery key; only provider-confirmed non-acceptance or a valid deduplication
promise permits another attempt. A concrete provider's monitoring must alert on
failed/uncertain rows and backlog age. Sent and terminal records are retained for
`EMAIL_RETENTION_DAYS` (default 30); old queued records are also pruned. Do not
reduce retention below the configured invitation cooldown.

Rollback the API revision as described in [deploy.md](../../ops/deploy.md); the additive
schema remains compatible with the old revision. Keep delivery disabled during
provider changes. Do not run the down migration in production to undo a code
deployment: it removes preferences and delivery records.

## Dispatch and snapshots

Cancellation wins while work is pending or leased. Immediately before the provider
call, the worker atomically changes the owned lease to `dispatching`. Cancellation
leaves that state intact, so the provider outcome and message ID can still be
recorded. Work already dispatched cannot be recalled. Expired dispatches require
the provider idempotency guarantee or become uncertain; they are never silently
recorded as canceled.

The email language is snapshotted at enqueue with the actor/project text. Changing
the preference affects future invitations. Retries keep the same language and body
for the stable provider idempotency key.
