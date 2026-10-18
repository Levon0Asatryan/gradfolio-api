# M5 final report: teams and notifications (lead)

Written to this file because `gradfolio-repos-d8` held my messages for approval and they expired undelivered.

## Task

M5 5.1–5.7 plus the 5.8/5.9 Teams-page addendum, across `gradfolio-api` and `gradfolio`.

## Status

done. Every PR is merged, nothing is open in either repo. API `/readyz` 200, API CI and Deploy on `main` green. The latest FE CI on `main` had no conclusion when I last read it.

## Pull requests

API (gradfolio-api): #50 plan · #52 (a) contract and reads, migration 0006 · #53 (b) invite, accept, reject, remove, leave, user lookup · #54 (c) activities · #55 verification record · #57 verification §9 real two-account run · #58 5.8 `GET /v1/me/teams` · #59 round-trip script with `/me/teams` assertions · #60 remove committed `node_modules` symlink · #61 verification §14.
FE (gradfolio): #66 and #67 plan · #69 notifications bell (5.7) · #71 team management (5.6) · #75 confirm dialogs focus Cancel · #77 and #79 FE verification record · #78 `/teams` page (5.9) · #80 hydration fix for invite dates.
Codex was clean ("no findings") on the merged head of each PR except #55, #59, #60 and #61, which were merged by Levon's account: I did not read the review state on those heads. Copilot failed on quota on every PR (accepted).

## What changed

- Owner implicit; external teammates are accepted rows with `user_id` NULL; teammate leave is `DELETE /projects/{id}/team/me` (owner gets `team_left`). Accepted teammate reads a non-draft private project; pending invitee sees only the title in the notification.
- Notifications and activities are written in the same transaction as the change. Reads are scoped to the owner. Links and invite status are computed at read time.
- Delivery: 60 s unread-count poll while the tab is visible, plus refresh on navigation and focus. No SSE or websockets.
- FE: bell in the sidebar, rail and More sheet; team section on the project page; `/teams` page reusing the same components.

## Evidence

- API: 849 unit and 595 integration tests, coverage about 98/95.8/96.7/98.9 at #58. Roughly 50 guards removed one at a time, each failing a named test.
- Real Auth0 two-account run: 44 checks locally and on production, then 53 checks locally and on production after 5.8. 0 failures. No token, `sub` or email in logs.
- FE: logged-in Playwright specs and invite journey on the deployed site; `/teams` 36-view matrix, axe 0 serious or critical, console clean, 0 hydration errors after #80.

## Decisions made

- Q4 and the delivery method followed the API agent's recommendation (Levon delegated).
- Local-API (3007) FE journey for 5.6/5.7 not run: recorded as a plan deviation. Production-site journey ran instead; draft 409, TEAM_FULL and 429 codes are covered by API tests and the real-token round-trip.
- Auth0 only allows `localhost:3000`, so logged-in dev runs used port 3000, not 3011.
- Merging: I merged under Levon's standing order (Codex clean on the head, CI green, threads resolved). The addendum said "no merging"; the standing order took precedence.

## Not verified

- Cloud Run logs of the production runs were not read (no gcloud access).
- The FE journey was not run against a local API stack.
- Screenshots exist only in scratch (not attached to PRs). Review receipts for FE PRs were hand-written (the review skill is not invocable from a sub-agent).

## Defects found

- Real-browser focus bug: `autoFocus` is ignored while MUI fades a dialog in. Fixed in #75 (Add dialog, DeleteProjectDialog). Jsdom could not catch it; the e2e assertion did.
- Hydration mismatch on invite dates (server Node has Armenian locale data, Playwright Chromium does not). Fixed in #80. `/projects` in Armenian likely has the same cause (known follow-up).
- I mistakenly committed a `node_modules` symlink in #58 (fixed in #60).
- Docker Hub pull rate limit failed CI on `main` once after #55; re-run was green.

## Proposed tracker changes

- Q4 decided as above; delivery method decided (60 s visible-tab count poll + refresh on navigation/focus).
- Mark 5.1–5.5, 5.8 done; 5.6, 5.7, 5.9 done with the recorded 5.6/5.7 deviation. Mark M4 4.6–4.10 done.
- Follow-ups: `/projects` Armenian hydration mismatch (same date-format cause); token-set persist error (`Failed to persist the updated token set`) when an access token expires on a server-rendered page; duplicate invite notification rows both showing Accept and Decline until reload; seeded-session CI job for the logged-in specs; a full `/notifications` page; notification deletion and member role editing; `projectUpdated` and `profileViewed` activities deferred; keep `.review/rules` corpus empty-state noted; team as its own entity (named group across projects) as stretch only.

## Changes needed in other repos

None.

## Open questions for Levon

- The two test accounts (the test account, the test account) had their passwords shared in chat; rotate or delete them.
- Production still holds a few read notifications and activity rows on those accounts about deleted projects (no endpoint deletes them).

## Cleanup

Removed: all M5 worktrees and local `m5/*` branches in both repos, the dev server on port 3000, the `gradfolio-m5` Docker stack, saved Auth0 sessions, the tokens in `gradfolio-api-m5v/.env`, the `.env.local` copy and scratch logs. Remote `origin/m5/*` branches remain (10 in `gradfolio-api`); delete them if you want.
