# M8: Utilities and email

**Status:** the original ten tasks are closed (2026-11-01). Left: the email worker and first real email (T20–T22), PDF and browser evidence (T23, T24), a small decision (T25) and the close-out (T26). **Owner:** Narek (module chat and task chats), from 2026-10-18.
**Repos:** gradfolio-api, gradfolio.

**Goal:** a student downloads a résumé PDF built from their portfolio, and a teammate
invite also arrives by email in the invitee's language. The optional extras (AI
summary, tag suggestions, portfolio PDF, sharing by email) come only after the core
tasks, and only if Levon keeps them in scope.

Tracker rows: 8.1–8.8 in [../../tracker.md](../../tracker.md#m8-utilities). Decision
Q10 (AI, PDF, email) is in the tracker's Decisions table.

The PDF and preferences implementation is merged and the user verified both on
production. The user selected SendGrid for initial testing without a domain
purchase. Delivery remains disabled pending account/sender verification and
credentials. The adapter, signed webhook and job runbook are in PR #123.
See [SendGrid setup and trial limitations](sendgrid.md).
See [plan](plan.md), [verification](verification.md), and [email operations](email.md).
The main chat checked every task against its brief on 2026-11-01: see the
[audit](audit-2026-11-01.md) for what is evidenced and what is still open.
No production email delivery is claimed.

## Tasks

The **Status** column is the status of record for these tasks; the module chat keeps it
current. **Depends on** lists tasks that must be **merged** first.

| ID     | Task                                                                 | Repo     | Depends on | Tracker  | Status                                                                                                       | Brief                                        |
| ------ | -------------------------------------------------------------------- | -------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| M8-T1  | Résumé PDF: generator spike and decision                             | api, fe  | —          | 8.1      | closed 2026-11-01: PDFKit chosen and shipped. The missing comparison is in T23                               | [T1](tasks/M8-T1-resume-pdf-decision.md)     |
| M8-T2  | Résumé PDF: generation, where T1 decided                             | per T1   | T1         | 8.1      | closed 2026-11-01: endpoint live. Measurements and guard proofs moved to T23                                 | [T2](tasks/M8-T2-resume-pdf-generation.md)   |
| M8-T3  | Résumé PDF: download UI (options, entry points, en/ru/am)            | fe       | T2         | 8.1      | closed 2026-11-01: live, checked by hand. Browser checks moved to T24                                        | [T3](tasks/M8-T3-resume-pdf-ui.md)           |
| M8-T4  | Email: provider and sending domain, a proposal for Levon             | docs     | —          | Q10      | closed 2026-11-01: Resend proposal, superseded by SendGrid; Levon approved                                   | [T4](tasks/M8-T4-email-provider-decision.md) |
| M8-T5  | Email: mailer module, outbox table, sender job (fake provider first) | api      | —          | 8.6      | closed 2026-11-01: outbox, mailer, CLI merged                                                                | [T5](tasks/M8-T5-mailer-outbox.md)           |
| M8-T6  | Email: provider adapter and production sending                       | api, ops | T4, T5     | 8.6      | closed 2026-11-01: adapter, signed webhook and secrets done. The worker and a real send moved to T20 and T21 | [T6](tasks/M8-T6-provider-adapter.md)        |
| M8-T7  | Preferred language and email preferences (API)                       | api      | —          | 8.7, 8.8 | closed 2026-11-01: merged, checked on production                                                             | [T7](tasks/M8-T7-preferences-api.md)         |
| M8-T8  | Team invite email                                                    | api      | T5, T7     | 8.7      | closed 2026-11-01: code and tests merged. The production run moved to T21                                    | [T8](tasks/M8-T8-invite-email.md)            |
| M8-T9  | Settings: email preferences and language (FE)                        | fe       | T7         | 8.8      | closed 2026-11-01: live, checked by hand. Browser checks moved to T24                                        | [T9](tasks/M8-T9-settings-preferences-ui.md) |
| M8-T10 | Module verification and report                                       | api, fe  | T1–T9      | —        | closed 2026-11-01: superseded by T26                                                                         | [T10](tasks/M8-T10-verification.md)          |

**Stretch: closed on 2026-11-01 as not in v1.0.** Nobody built them, and the core tasks are not
finished. They can be reopened as new tasks after M9 if there is time.

| ID    | Task                                       | Tracker | Depends on |
| ----- | ------------------------------------------ | ------- | ---------- |
| M8-S1 | AI summary of a project (provider per Q10) | 8.2     | —          |
| M8-S2 | Tag suggestions from the description       | 8.3     | —          |
| M8-S3 | Portfolio PDF export                       | 8.4     | T2         |
| M8-S4 | Share a portfolio by email                 | 8.5     | T6         |

## New tasks (opened 2026-11-01 for the work that is left)

Task IDs start at T20, because T1–T19 would collide with the queue rows `M8-T11` to `M8-T14`
in Levon's `manual-testing.md` (the things only he can do). In a brief, "queue M8-T11" always
means a queue row.

| ID     | Task                                                                      | Repo     | Depends on        | Tracker  | Status | Brief                                          |
| ------ | ------------------------------------------------------------------------- | -------- | ----------------- | -------- | ------ | ---------------------------------------------- |
| M8-T20 | Email worker: create the Cloud Run job (delivery off) and the way it runs | api, ops | queue M8-T11      | 8.6      | todo   | [T20](tasks/M8-T20-email-worker.md)            |
| M8-T21 | First real invite email on production, and the acceptance steps for it    | api, fe  | T20, queue M8-T14 | 8.6, 8.7 | todo   | [T21](tasks/M8-T21-first-real-email.md)        |
| M8-T22 | Email operations: alerts, the pause switch, and the trial-end decision    | api, ops | T21, queue M8-T12 | 8.6      | todo   | [T22](tasks/M8-T22-email-operations.md)        |
| M8-T23 | Résumé PDF evidence: generator rationale, p95 and memory, guard proofs    | api      | —                 | 8.1      | todo   | [T23](tasks/M8-T23-pdf-evidence.md)            |
| M8-T24 | Browser checks for the PDF dialog, Settings and the unsubscribe page      | fe       | —                 | 8.1, 8.8 | todo   | [T24](tasks/M8-T24-browser-checks.md)          |
| M8-T25 | Decide the Resend adapter: keep it documented or remove it                | api      | —                 | 8.6      | todo   | [T25](tasks/M8-T25-resend-adapter-decision.md) |
| M8-T26 | Module close-out: the PASS/FAIL table and `report.md`                     | api, fe  | T21, T23, T24     | —        | todo   | [T26](tasks/M8-T26-closeout.md)                |

Lanes: **T20 → T21 → T22** (email, needs Levon's queue rows), **T23** and **T24** (evidence,
independent, can start now), **T25** (small decision), then **T26**.

## Order and parallel lanes (original plan)

```
Lane A (PDF):     T1 ──► T2 ──► T3
Lane B (email):   T5 ─────────┐
                  T4 ──► T6 ◄─┘
                  T7 ──► T8 (also needs T5)
                  T7 ──► T9
Close:            T10 after all of the above
```

- **Start in parallel:** T1, T4, T5 and T7. None depends on another.
- **T4 is a proposal.** Levon decides the provider and the domain (his queue item
  OR-T8). Until then, T5 and T8 run against the fake provider, so they are not
  blocked.
- **T6 is the only task that needs production changes:** a Secret Manager secret, a
  Cloud Run job and a scheduler. Levon (or the main chat) makes those clicks, from
  exact steps in the PR.

## Rules for every M8 task

- Follow [../README.md](../README.md) for chat levels, status, merging and "Needs
  Levon".
- Follow each repo's `CLAUDE.md` and `AGENTS.md`: the four phases, guards proved by
  removal, races forced with a barrier.
- **Both reviewers on every push** (`sh scripts/request-review.sh <pr>`). When Codex
  doesn't answer, a reviewer sub-agent with fresh context reviews instead.
- **M7 is running in parallel** (Levon's machine; branches `m7/*`).
  - Don't touch its branches.
  - Rebase on `main` before every push.
  - Migrations take the next free number.
  - If a file you need is changing in an open M7 PR (the Settings page,
    `src/lib/api/client.ts`, the locales), say so in your PR, and rebase after it
    merges.
- **Production:** every merge to `main` deploys (API to Cloud Run, FE to Vercel).
  Migrations must be additive and safe while the previous revision is still serving.
- **Test accounts:** use your own Gradfolio account for real-token runs, and never
  share a password or token in a chat, PR or file.

## Exit

- A logged-in student downloads a résumé PDF in en, ru or am: Armenian and Cyrillic
  render correctly, and it contains only that student's own data.
- Inviting a registered user queues exactly one email. With the fake provider it's
  recorded; in production it arrives, in the invitee's language, with a working
  unsubscribe link.
- Turning invite emails off in Settings stops them.
- `verification.md` in this folder records each check (written by T10).
