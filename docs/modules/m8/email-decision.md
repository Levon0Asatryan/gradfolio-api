# M8 production email decision

2026-10-22. Narek asked to finish M8 and delegated provider selection. Choose
**Resend Free**, subject to verifying an owned sending domain and a real mailbox
smoke. No provider account, DNS access or paid resources have been created or
verified. The user confirmed on 2026-10-23 that no sending domain is available.

## Comparison

Official pages checked on 2026-10-22; prices are USD before taxes.

| Provider                                                                                | Free allowance                  | First paid plan                       | Retry suitability                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Resend](https://resend.com/pricing)                                                    | 3,000/month, 100/day            | $20/month, 50,000                     | [24-hour idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys); signed webhooks                                                        |
| [Postmark](https://postmarkapp.com/pricing/)                                            | 100/month, no expiry            | $15/month, 10,000                     | [No native idempotency keys](https://postmarkapp.com/support/article/what-is-an-idempotency-key); uncertain acceptance needs reconciliation                   |
| [Brevo](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans) | 300/day                         | Volume-dependent; confirm at checkout | [Batch idempotency TTL is 30 minutes](https://developers.brevo.com/docs/heterogenous-versions-batch-emails); do not assume this covers single-message retries |
| [SendGrid](https://www.twilio.com/en-us/products/email-api/pricing)                     | Trial only: 100/day for 60 days | $19.95/month                          | Signed event webhooks; no send-idempotency promise established in this investigation                                                                          |

Resend fits coursework traffic and the existing delivery-key design. Its Free
plan includes one webhook endpoint and all event types. No education discount is
offered. No student discount is assumed for any candidate.

## Provider contract and implementation

- Send through `POST https://api.resend.com/emails`; native Node fetch, no redirects,
  caller AbortSignal, fixed API origin, bounded response. Sender and reply-to are
  deployment configuration. Never log request/response content or credentials.
- Keep the outbox UUID as `Idempotency-Key`; send it as the `outbox_id` tag for
  feedback correlation. Preserve the exact payload on retry, including sender.
  Treat sender changes like a provider change: pause, drain/reconcile, then change.
- Advertise a conservative window shorter than Resend's 24 hours. Documented
  rejection responses may retry; transport errors, malformed success and unknown
  errors remain uncertain. Never blindly retry uncertain rows.
- Verify Svix signatures against the original bytes, including timestamp freshness
  and constant-time comparison, before trusting JSON or tags. Handle
  `email.bounced` and `email.complained`; duplicates must be harmless. Other signed
  events are acknowledged without changing preferences. Missing configuration
  returns 503; bad signatures return 400; bound/rate-limit the endpoint.
- Use one Cloud Run job with one task, a dedicated DML runtime identity, and
  Cloud Scheduler OAuth invocation. Keep delivery off until controlled smoke tests
  pass. Alert on failed executions, terminal outbox outcomes and old pending work.

References: [send API](https://resend.com/docs/api-reference/emails/send-email),
[errors](https://resend.com/docs/api-reference/errors),
[signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests),
[Svix protocol](https://docs.svix.com/receiving/verifying-payloads/how-manual),
[events](https://resend.com/docs/webhooks/event-types).

## Domain, sender and data

Use `mail.<owned-domain>` to isolate mail reputation. Proposed sender:
`Gradfolio <invites@mail.<owned-domain>>`; reply-to must be a monitored mailbox
chosen by the owner. These are placeholders, not verified production addresses.
The `gradfolio.app` Auth0 audience is an identifier, not proof of domain ownership.
The Vercel hostname is not an owned sending domain.

Prefer a subdomain of an already owned domain ($0 incremental registration).
Otherwise the owner selects and buys a domain after checking first-year and
renewal prices. Eligible students can check current domain offers in the
[GitHub Student Pack](https://education.github.com/pack); eligibility and renewal
are not assumed. Copy SPF/DKIM records from Resend's domain screen exactly; add
DMARC after checking existing domain policy. Do not replace an existing root SPF
record or invent DNS values. Disable open/click tracking, preserving unsubscribe
fragments. See [domain verification](https://resend.com/docs/dashboard/domains/introduction).

Choose North Virginia to match the API. Resend also offers Ireland, Sao Paulo and
Tokyo sending; [sending region does not change US account-data storage](https://resend.com/docs/dashboard/domains/regions).
The provider receives account email, inviter/project text and message content;
our logs must contain no addresses or tokens. Only invitation notifications are
in scope, with an explicit opt-out; no marketing is authorized. Before enabling,
the account owner completes the provider's required sender identity/address and
reviews its terms and privacy requirements. Do not add a personal postal address
to repository files.

## Owner steps and release gates

1. Create/sign in to the project Resend account; remain on Free. Verify the account.
2. Supply an owned domain or purchase one with an explicitly agreed budget. Add
   `mail.<domain>` in Resend and copy its DNS records at the registrar. Wait for
   verification; check SPF, DKIM and DMARC in a received message.
3. Create a domain-scoped sending API key. Put it directly in Secret Manager as
   `gradfolio-resend-api-key`; never send it through chat. Put a random unsubscribe
   secret there as `gradfolio-email-unsubscribe-secret` as well.
4. After deployment, register the API webhook `/v1/email/webhooks/resend` for
   bounced/complained events. Store its signing secret directly in Secret Manager
   as `gradfolio-resend-webhook-secret`. Supply it only to the API, the API key
   only to the worker, and the unsubscribe secret to both.
5. Configure sender, reply-to and frontend origin. Run the worker manually against
   a newly created test invitation. Confirm one delivery, en/ru/am rendering,
   login-required team link, opt-out and unsubscribe. Run twice: no duplicate.
   Exercise a real signed bounce/complaint using provider test facilities.
6. Inspect redacted logs and alerts; only then enable scheduling. Scheduler costs
   [up to $0.10/job/month](https://cloud.google.com/scheduler/pricing) after the
   billing account's three free jobs. Cloud Run execution, secrets and logging
   are usage-dependent, not guaranteed free. Approve those costs before creation.
7. Record deployed revision and redacted results in verification.md, then close T6
   and T10. PDF/Settings already passed the user's production smoke; real email
   has not yet passed.

## Remaining scope

AI summary, tag suggestions, full portfolio PDF and sharing by email remain the
plan's stretch features. Finishing required M8 means delivered invite email and
the release gates above; no external AI service or marketing mail is enabled.
