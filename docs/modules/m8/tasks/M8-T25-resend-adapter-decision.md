# M8-T25: Decide the Resend adapter

**Repo:** gradfolio-api · **Depends on:** — · **Tracker:** 8.6 · **Size:** a decision, maybe one small PR

## Context

The provider changed from Resend to SendGrid on 2026-10-23, but the Resend adapter, its webhook
(`/v1/email/webhooks/resend`) and settings (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`) are still
in the code and `EMAIL_PROVIDER` accepts `resend`.

## Goal

One clear state: documented alternative or removed.

## Scope

Propose in the PR which it is, and why. **Levon decides.** If removed: delete the adapter, the
webhook controller, the config keys, their tests and the docs, with all tests passing and the
OpenAPI document regenerated. If kept: say in `email.md` that it is untested in production and
how to switch.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
The audit that opened this task is [../audit-2026-11-01.md](../audit-2026-11-01.md). Report in the PR
body (`docs/process/handoff-template.md` part 2). Do not merge. Never write a secret into a
file, a PR or a chat.
