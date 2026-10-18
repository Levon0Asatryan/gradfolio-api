# M8-T4: Email: provider and sending domain, a proposal

**Repo:** gradfolio-api (docs PR) · **Depends on:** — · **Tracker:** Q10, 8.6 · **Size:** one docs PR

## Context

Invite emails (8.7) need a transactional email provider and a domain we can send from.
`*.vercel.app` can't be verified for sending, so a real domain is needed. The tracker
lists candidates: Resend, Postmark, SendGrid, Brevo. The API runs on Cloud Run in
`us-east1`; secrets go in Secret Manager. Levon's queue item OR-T8 waits on this.

## Goal

`docs/modules/m8/email-decision.md` with a recommendation Levon can approve in five
minutes.

## Scope

In (check the live pricing pages and cite them; don't recall):

- For each candidate: free tier (emails per month and per day), price after it, whether
  a student plan exists, regions, API quality (SDK, idempotency keys, webhooks for
  bounces and complaints), deliverability tooling, and how SPF/DKIM/DMARC are set up.
- The domain: options (a cheap domain bought for the project, a student-offer domain
  such as GitHub Student Pack offers, or a subdomain of a domain Levon owns), what DNS
  records the provider will ask for, and who adds them.
- The "from" address and reply-to; a test sender for non-production.
- Compliance for one transactional email type: an unsubscribe link, the sender's
  postal address if required, and what's stored (addresses, bounce flags).
- A recommendation, the monthly cost (expected: about $0), and the exact steps Levon
  must do (accounts, DNS records, the API key into Secret Manager).

Out: code.

## Needs Levon

**Levon decides** the provider and the domain, and does the DNS and account steps.
Never ask for or paste an API key in chat: Levon puts it into Secret Manager himself.

## Acceptance

- The document has the comparison table with links, one recommendation, the cost, and a
  numbered "what Levon does" list.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Never write a secret into a file, a PR or a chat.
