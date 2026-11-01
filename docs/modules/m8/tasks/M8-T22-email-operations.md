# M8-T22: Email operations: alerts, pause switch, trial end

**Repo:** gradfolio-api, ops · **Depends on:** T21, queue M8-T12 · **Tracker:** 8.6 · **Size:** one PR

## Context

SendGrid's free trial ends **2026-12-22**, after which it is $19.95 a month. Step 8 and 9 of
[../sendgrid-handoff.md](../sendgrid-handoff.md) are this task. No paid upgrade and no domain
purchase is authorized.

## Goal

Email failures are noticed, sending can be stopped in one command, and the trial end has a
recorded decision.

## Scope

In:

- Alerts (log-based or metric-based, free tier first) for failed and for backlogged outbox
  rows, and for webhook signature failures. Show any cost before creating them.
- A pause switch: one command that sets `EMAIL_DELIVERY_ENABLED=false` on the job and, if a
  schedule exists, pauses it. In `docs/ops/deploy.md`.
- The trial-end decision from queue M8-T12 recorded in the tracker's Q10 row and in
  `docs/modules/m8/sendgrid.md`: stop sending at expiry, or a named long-term service. If
  stopping, invitations still work (the in-app notification), and the Settings page says
  email is unavailable.

## Acceptance

- A forced failure (a bad key in a staging run, never production) raises the alert; the pause
  command is run once and its effect shown.
- The decision is written down with its date.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
The audit that opened this task is [../audit-2026-11-01.md](../audit-2026-11-01.md). Report in the PR
body (`docs/process/handoff-template.md` part 2). Do not merge. Never write a secret into a
file, a PR or a chat.
