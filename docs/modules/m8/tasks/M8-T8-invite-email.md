# M8-T8: Team invite email

**Repo:** gradfolio-api · **Depends on:** T5 and T7 merged · **Tracker:** 8.7 · **Size:** one PR

## Context

M5 builds invites: the owner invites a registered user to a project, and a notification is
written in the same transaction (`src/api/team/services/team-write.service.ts`). Re-inviting
after a rejection is an UPDATE back to `pending`. T5 gives `OutboxService.enqueue`; T7 gives
the language and the `team_invites` preference.

## Goal

An invited user also gets an email, in their language.

## Scope

In:

- On invite (and re-invite), in the **same transaction** as the invite row and the
  notification, enqueue one email to the invitee's account email, unless they turned
  invite emails off or the address is unverified or has bounced.
- Content: who invited them, the project title, and a link to `/teams` on the frontend.
  There is no accept-by-link: accepting needs a login. A plain-text part and an HTML
  part, in en/ru/am, with the unsubscribe link from T7. No private project details beyond
  the title the invitee may already see in the notification.
- At most one invite email per project and invitee per 24 hours (the idempotency key
  includes the day), so invite spam is capped.
- Only registered users with an account email are emailed. Named teammates without an
  account never are (Q4).
- A failed enqueue fails the invite (it's the same transaction), and a failed _send_
  never affects the invite.

Out: any other email type.

## Acceptance

- Integration tests: invite → one outbox row with the right locale; preference off → none;
  re-invite within 24 hours → no second row, after 24 hours → one; a rolled-back invite →
  no row; a named teammate → none.
- Guards proved by removal: the transaction coupling, the preference check, the daily cap.
- A real-token run (your own account): invite a second test account on production and
  confirm the mail arrives (after T6 is live), unsubscribe works.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. Report in the PR body, in the format from `docs/process/handoff-template.md` part 2.
Do not merge. Never write a secret into a file, a PR or a chat.
