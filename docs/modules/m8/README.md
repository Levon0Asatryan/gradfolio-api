# M8: Utilities and email

**Status:** next. **Owner:** Narek (module chat and task chats), from 2026-10-18.
**Repos:** gradfolio-api, gradfolio.

**Goal:** a student downloads a résumé PDF built from their portfolio, and a teammate
invite also arrives by email in the invitee's language. The optional extras (AI
summary, tag suggestions, portfolio PDF, sharing by email) come only after the core
tasks, and only if Levon keeps them in scope.

Tracker rows: 8.1–8.8 in [../../tracker.md](../../tracker.md#m8-utilities). Decision
Q10 (AI, PDF, email) is in the tracker's Decisions table.

## Tasks

The **Status** column is the status of record for these tasks; the module chat keeps it
current. **Depends on** lists tasks that must be **merged** first.

| ID     | Task                                                                 | Repo     | Depends on | Tracker  | Status | Brief                                        |
| ------ | -------------------------------------------------------------------- | -------- | ---------- | -------- | ------ | -------------------------------------------- |
| M8-T1  | Résumé PDF: generator spike and decision                             | api, fe  | —          | 8.1      | todo   | [T1](tasks/M8-T1-resume-pdf-decision.md)     |
| M8-T2  | Résumé PDF: generation, where T1 decided                             | per T1   | T1         | 8.1      | todo   | [T2](tasks/M8-T2-resume-pdf-generation.md)   |
| M8-T3  | Résumé PDF: download UI (options, entry points, en/ru/am)            | fe       | T2         | 8.1      | todo   | [T3](tasks/M8-T3-resume-pdf-ui.md)           |
| M8-T4  | Email: provider and sending domain, a proposal for Levon             | docs     | —          | Q10      | todo   | [T4](tasks/M8-T4-email-provider-decision.md) |
| M8-T5  | Email: mailer module, outbox table, sender job (fake provider first) | api      | —          | 8.6      | todo   | [T5](tasks/M8-T5-mailer-outbox.md)           |
| M8-T6  | Email: provider adapter and production sending                       | api, ops | T4, T5     | 8.6      | todo   | [T6](tasks/M8-T6-provider-adapter.md)        |
| M8-T7  | Preferred language and email preferences (API)                       | api      | —          | 8.7, 8.8 | todo   | [T7](tasks/M8-T7-preferences-api.md)         |
| M8-T8  | Team invite email                                                    | api      | T5, T7     | 8.7      | todo   | [T8](tasks/M8-T8-invite-email.md)            |
| M8-T9  | Settings: email preferences and language (FE)                        | fe       | T7         | 8.8      | todo   | [T9](tasks/M8-T9-settings-preferences-ui.md) |
| M8-T10 | Module verification and report                                       | api, fe  | T1–T9      | —        | todo   | [T10](tasks/M8-T10-verification.md)          |

**Stretch.** No briefs yet. Levon decides at the T4 stop point whether any of these stay
in v1.0.

| ID    | Task                                       | Tracker | Depends on |
| ----- | ------------------------------------------ | ------- | ---------- |
| M8-S1 | AI summary of a project (provider per Q10) | 8.2     | —          |
| M8-S2 | Tag suggestions from the description       | 8.3     | —          |
| M8-S3 | Portfolio PDF export                       | 8.4     | T2         |
| M8-S4 | Share a portfolio by email                 | 8.5     | T6         |

## Order and parallel lanes

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
