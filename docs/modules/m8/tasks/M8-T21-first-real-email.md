# M8-T21: First real invite email on production

**Repo:** gradfolio-api, gradfolio · **Depends on:** T20, queue M8-T14 (a second account and a mailbox) · **Tracker:** 8.6, 8.7 · **Size:** one evidence PR

## Context

T8 and T10 required a real run that never happened, because delivery is off and no worker
exists. After T20 it can be done once, carefully.

## Goal

One controlled invite produces exactly one email that arrives, is correct, and can be
unsubscribed from, and the system behaves on a bounce.

## Scope

In (this is the T10 brief's steps 3 to 8, for email):

1. Pick a recipient account with a verified account email and invitation emails on, and a
   mailbox Levon controls (queue M8-T14). Enqueue one **new** invite from the owner account.
2. Turn delivery on **for the job only** (`EMAIL_DELIVERY_ENABLED=true` on the job), run it
   once. `sent` means the provider accepted it, not that it reached the inbox: check the
   mailbox and the outbox row.
3. The mail: the invitee's language, who invited, the project title, the `/teams` link opens
   after login, headers show SPF/DKIM through the Single Sender, plain text part present.
4. Run the job again: nothing is sent twice.
5. Unsubscribe from the real mail: it turns invitations off, a tampered or expired link is
   refused, and a second invite sends nothing.
6. Signed feedback: use SendGrid's test facilities for a bounce and a spam report; the webhook
   answers 200 on the signed event, 400 on an unsigned one, and the address is skipped after.
7. The worker's logs contain no address, token or key.
8. Turn delivery off again unless T22 says otherwise.

Out: alerts and the trial decision (T22).

## Acceptance

PASS/FAIL for each step, with redacted evidence, in [../verification.md](../verification.md).
An ambiguous send stays `uncertain` and is inspected in SendGrid before any retry.

## Needs Levon

Queue M8-T14: a second account and a mailbox. Never paste a password or key in a chat.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
The audit that opened this task is [../audit-2026-11-01.md](../audit-2026-11-01.md). Report in the PR
body (`docs/process/handoff-template.md` part 2). Do not merge. Never write a secret into a
file, a PR or a chat.
