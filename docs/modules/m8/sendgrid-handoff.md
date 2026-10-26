# SendGrid deployment handoff for Levon

Updated 2026-10-25. Narek selected SendGrid and confirmed Single Sender
verification. The sending API key and signed Event Webhook public key are saved
privately with Narek. His Google account cannot see the current Gradfolio GCP
project. Do not create a second cloud project or send credentials in chat.

## Already prepared

- Provider adapter and signed endpoint `/v1/email/webhooks/sendgrid` in PR #123.
- Expected sender: `gradfolio.app@gmail.com`; confirm the exact verified address
  in SendGrid before configuring `EMAIL_FROM`.
- Webhook: `Gradfolio email feedback`; Bounce and Spam Reports selected, signature
  verification enabled, endpoint disabled pending deployment/configuration.
- Delivery defaults to false. The trial ends **2026-12-22**, per dashboard.
  No paid SendGrid upgrade or domain purchase is authorized.

## Owner actions, in order

1. Review/merge the current PR and wait for the existing Cloud Run API deployment
   to finish. Confirm the deployed SHA and `/readyz`; do not deploy an older
   Resend-only image. Use the same image SHA later for the worker.
2. In project `project-33e407b5-7fd5-485d-8dc`, install the privately held keys as
   Secret Manager versions. Narek can enter them directly during a shared session
   or after receiving appropriate project access:
   - `gradfolio-sendgrid-api-key`: Mail Send-only `SG.…` credential.
   - `gradfolio-sendgrid-webhook-key`: base64 ECDSA public verification key.
   - `gradfolio-email-unsubscribe-secret`: generate a random value of at least
     32 characters, or preserve the existing value if already provisioned.
     The webhook public key is public; it must never be confused with the API key.
3. Follow the exact IAM/network/job commands in [deploy.md](../../ops/deploy.md#m8-invitation-email-sendgrid-disabled-until-acceptance).
   Grant the worker identity access to DB, sending key and unsubscribe secret.
   Grant the API identity access to webhook key and unsubscribe secret. Use
   `SENDGRID_WEBHOOK_PUBLIC_KEY` on the API; keep its delivery flag false.
4. Check a request with no signature returns 400 after key installation (503
   indicates missing configuration). Enable the saved SendGrid webhook and run
   Test Integration. A valid signed test batch without outbox arguments returns
   200 without touching user preferences. If it fails, disable the webhook and
   check key selection/raw payload handling; never bypass signature verification.
5. Create `gradfolio-email-worker` with `EMAIL_PROVIDER=sendgrid`,
   `EMAIL_FROM=gradfolio.app@gmail.com`, the monitored reply-to and production
   frontend origin. Start with `EMAIL_DELIVERY_ENABLED=false`, one task,
   parallelism 1, max retries 0. The runbook contains exact commands. Do not
   provision a schedule until operating costs are accepted; SendGrid's free
   trial does not guarantee Google Cloud usage is free.
6. Confirm the recipient account has a verified account email and invitation
   email enabled. Enqueue one **new** controlled invitation; old invitations may
   have expired or been answered. Set delivery true **on the job only**, run it
   once, and inspect mailbox and the outbox row. `sent` means provider acceptance,
   not proof of inbox delivery. Run again to confirm no second delivery.
7. Verify en/ru/am, `/teams` login, unsubscribe and Settings opt-out. Verify signed
   bounce/spam feedback with controlled test facilities and inspect redacted logs.
   Ambiguous sends stay `uncertain`: inspect provider activity before any retry.
8. Configure failure/backlog alerts, then optionally schedule the job and set
   GitHub Actions variable `GCP_EMAIL_JOB=gradfolio-email-worker`. Record deployed
   SHA, date and redacted acceptance results in [verification.md](verification.md).
   Pause the schedule and disable delivery if a check fails.
9. Before 2026-12-22, decide whether to disable sending at trial expiry or approve
   a different long-term service. Do not silently upgrade to a paid subscription.

## Completion boundary

Code and local/CI evidence do not close real delivery. M8 email production gates
remain open until this checklist has observed results. No GCP resource or secret
has been changed by this PR. PDF and Settings were already user-tested live.
