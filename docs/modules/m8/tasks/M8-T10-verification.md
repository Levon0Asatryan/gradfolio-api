# M8-T10: Module verification and report

**Repo:** gradfolio-api and gradfolio · **Depends on:** T1–T9 merged · **Size:** two small docs PRs

## Goal

Record that M8 works end to end, on production, as one acceptance run.

## Scope

In:

- `docs/modules/m8/verification.md` (API repo) and `docs/fe-m8-verification.md` (FE repo), in the format of
  `docs/modules/m6/verification.md`: each check, its command or steps, the result, PASS/FAIL/GAP.
- The run:
  1. A student with a filled profile downloads a résumé PDF in en, ru and am on the
     deployed site; the files are opened and read (Armenian and Cyrillic glyphs), and
     contain only that student's data.
  2. A second account's PDF never contains the first account's data.
  3. Invite a registered user: exactly one outbox row, one email delivered, in the
     invitee's language; the link opens `/teams`.
  4. Switch invite emails off in Settings: a second invite sends nothing.
  5. The unsubscribe link from a real email works once, and a tampered link is refused.
  6. A bounced address (use the provider's test address) is `skipped` afterwards.
  7. Cloud Run: the sender job's logs contain no address, token or key.
  8. `/readyz` 200; the job run twice sends nothing twice.
- Update this module's task table to `done`, write `report.md` (format: handoff-template
  part 2, with "Proposed tracker changes" and "Needs Levon"), and list the stretch tasks
  still open.

## Needs Levon

Test accounts and mailboxes for steps 3–6 (a second account and a mailbox he controls).
Add them as rows to his queue; never ask for passwords.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Never write a secret into a file, a PR or a chat.
