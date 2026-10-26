# SendGrid invitation delivery

2026-10-23: the user selected SendGrid instead of Resend and requested no domain
purchase. `EMAIL_PROVIDER` now defaults to `sendgrid`; delivery still defaults
to false. Resend remains an optional adapter for compatibility.
On 2026-10-25 the user confirmed a verified Single Sender, a Mail Send API key
and a saved signed Event Webhook public key. The keys remain privately held by
the user; they have not been installed in Google Cloud. The configured webhook
is disabled. The account dashboard showed a trial end of **2026-12-22**.
No application email has been sent through the real provider yet.

## Account and sender

Create the project account at https://signup.sendgrid.com/ and verify the account
email. In Settings → Sender Authentication → Single Sender Verification, verify
the project mailbox. This permits initial testing without purchasing a domain.
Use the owner's real required account details privately, never in this repository.
Twilio recommends domain authentication for production delivery; Gmail/Yahoo
sender addresses can be rejected or placed in spam.

The current free trial is **60 days, up to 100 emails/day**. It is not a permanent
free plan. Do not activate a paid subscription. Record the actual trial end date
from the account; sending stops after expiry unless upgraded. A short test/demo
can use the trial, but permanent M8 delivery remains unresolved after that date.

Sources: [trial/pricing](https://www.twilio.com/en-us/products/email-api/pricing),
[Single Sender](https://www.twilio.com/docs/sendgrid/ui/sending-email/sender-verification),
[sender identity](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/sender-identity).

## Configuration

- Worker: `EMAIL_PROVIDER=sendgrid`, `SENDGRID_API_KEY` (Mail Send permission only),
  `EMAIL_FROM` equal to the verified sender, optional monitored `EMAIL_REPLY_TO`.
- API: `SENDGRID_WEBHOOK_PUBLIC_KEY`, the base64 ECDSA key from Signed Event
  Webhook settings. It is a public verification key, not the sending API key.
- Both: `EMAIL_UNSUBSCRIBE_SECRET`; worker also needs `EMAIL_PUBLIC_URL` and DB
  access. Store credentials directly in Secret Manager, never in chat or git.
- Create the Event Webhook URL
  `https://gradfolio-api-1058577031182.us-east1.run.app/v1/email/webhooks/sendgrid`,
  enable Signed Event Webhook, and select Bounce and Spam Reports. The service
  verifies SHA256(timestamp + raw body), freshness and each batch before writes.
  Unsigned requests return 400, missing configuration 503. Signed provider test
  events without an outbox argument are acknowledged without changing rows.

Levon's remaining deployment checklist is [sendgrid-handoff.md](sendgrid-handoff.md).

Use the disabled Cloud Run job definition in [deploy.md](../../ops/deploy.md),
with the SendGrid variables/secrets. First test one controlled invitation
manually. Confirm subject, HTML/plain text, en/ru/am, login-required team link,
unsubscribe, signed feedback and redacted logs. Enable scheduling only after
those results are recorded. Cloud resources can incur charges independently of
the SendGrid trial; the owner must agree to the operating budget first.

## Delivery safety

The adapter calls `POST https://api.sendgrid.com/v3/mail/send`. Only 202 with a
bounded `X-Message-ID` counts as accepted; accepted does not prove inbox delivery.
The outbox UUID travels as `custom_args.outbox_id`, not an idempotency guarantee.
The signed event's `sg_message_id` is correlated with the request ID, including
SendGrid's per-message suffix. Bounce/spamreport suppress the current destination.
Open/click tracking stays off so unsubscribe fragment links remain intact.

SendGrid has no send-deduplication promise used by this adapter. Therefore
transport timeouts, ambiguous responses, 5xx and expired dispatch leases become
`uncertain`, with **no automatic resend**. Only documented definite rejections
may retry (429); known invalid requests/credentials fail permanently. An operator
must reconcile an uncertain row with provider activity/custom arguments before
any new attempt. No exactly-once delivery claim is made.

References: [Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send),
[X-Message-ID](https://www.twilio.com/docs/sendgrid/glossary/x-message-id),
[signed webhook](https://github.com/sendgrid/sendgrid-go/blob/main/helpers/eventwebhook/eventwebhook.go).
