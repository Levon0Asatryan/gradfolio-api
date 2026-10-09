# M5 verification

The final test record for M5 on the API side: tracker 5.1–5.5 and what FE tasks 5.6–5.7
need from the API, [m5-plan.md](m5-plan.md). Fresh-clone, integration, HTTP and guard runs
on 2026-10-09 against MySQL 8.4.11, on `m5/c` at `4936d97` (main `4fe0930` plus PR #54).
One item needs a real Auth0 token for each of two accounts and Levon's hands; it is marked
**PENDING** with the exact steps (§9) and is filled in by the next commit of this PR.

No token, secret or email appears in this record. Local-tenant tokens were signed by the
test JWKS server. Every database run below started from an **empty volume**
(`docker-compose -p gradfolio-m5 down -v`) on this worktree's own project and port (MySQL
3313).

## 1. Pull requests

| PR   | What                                                        | Merge     | Reviews                                                                                                                             |
| ---- | ----------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| #50  | plan; Q4 and the delivery method                            | `c430d12` | one round (4 comments, handled by the lead)                                                                                         |
| #52  | (a) migration 0006, team reads, notifications               | `e534af1` | round 1: 2 P2 (seed still wrote legacy message and link; no failure test for the page-size refine), both fixed; confirmation: clean |
| #53  | (b) invite, external, remove, accept, reject, leave, lookup | `4fe0930` | Codex: no findings; Copilot: quota failure                                                                                          |
| #54  | (c) activities                                              |           | round 1: 3 P2 (params and a key differed from the plan, cursor time beyond the Date range), all fixed; confirmation round requested |
| this | verification (docs, `scripts/team-roundtrip.mjs`)           |           | docs-only                                                                                                                           |

Copilot failed on quota on every push; Codex reviewed alone.

## 2. Summary

| #   | Check                                                                            | Result                                                              |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Fresh clone: `npm ci`, build, verify                                             | PASS (45 files, 845 tests)                                          |
| 2   | Coverage ≥ 90 %                                                                  | PASS: statements 98.0, branches 95.81, functions 96.63, lines 98.87 |
| 3   | Integration against MySQL 8.4.11                                                 | PASS (35 files, 579 tests)                                          |
| 4   | Migration 0006: applied twice (second a no-op); down then up identical; types    | PASS (§3)                                                           |
| 5   | OpenAPI: `openapi:check`; routes both ways                                       | PASS (45 operations on 34 paths)                                    |
| 6   | Second user: 404 on every write; the other party's notifications unreadable      | PASS (§4)                                                           |
| 7   | Q4 visibility matrix (accepted / pending / rejected / removed × private / draft) | PASS (§5)                                                           |
| 8   | Transaction proofs, both directions                                              | PASS (§6)                                                           |
| 9   | Races forced with a barrier                                                      | PASS (§7)                                                           |
| 10  | Two-account journey over HTTP against the compiled server, local test tenant     | PASS: 42 checks (§8)                                                |
| 11  | Two-account journey with real Auth0 tokens                                       | **PENDING** (§9)                                                    |
| 12  | Production `GET /readyz`                                                         | 200 (2026-10-09; the lead confirms again after the Deploy of #54)   |
| 13  | Guards proved by removal                                                         | PASS: 60+ guards (§10)                                              |

## 3. Fresh clone, migration

`git clone <worktree> clone && git checkout m5/c` (local repository, no push), then:
`npm ci`, `npm run build`, `npm run verify` (format, lint, types, OpenAPI check, 845 unit
tests), `npm run test:coverage` (thresholds 90 on every metric), `npm run test:int` (35
files, 579 tests, real MySQL 8.4.11), and `db:types:check` ("up to date").

Migration `0006_team_notifications` (additive; the previous revision never reads what it
adds):

- applied to an empty database: 4 steps; run again: "nothing to apply";
- `migrate:down` then `migrate`: the schema dump (`npm run db:schema`) is **identical** to
  the first one; the dump after `down` differs from it by exactly the `params` column and its
  CHECK, the `team_left` enum value and the two indexes;
- `EXPLAIN` of the newest-first lists uses `idx_notifications_user_created` and
  `idx_activities_user_ts` with no filesort (a test in `checks.int.test.ts`);
- the CI Migrations job (up, down `--all`, up, schema compare) passed on every PR.

## 4. Second user

Tests in `team/e2e/team-writes`, `team/e2e/team`, `notifications/e2e/notifications`,
`activities/e2e/activities`. The four callers below get the same 404 body as for an unknown
id, and the rows are unchanged afterwards:

| Endpoint                                             | Stranger       | Accepted teammate | Pending invitee | Owner    | Other                              |
| ---------------------------------------------------- | -------------- | ----------------- | --------------- | -------- | ---------------------------------- |
| `GET /projects/:id/team`                             | 404            | 404               | 404             | 200      | 401 anonymous                      |
| `POST /projects/:id/team` (invite)                   | 404            | 404               | 404             | 201      | 400 self, 404 private/unknown user |
| `POST /projects/:id/team/external`                   | 404            | 404               | 404             | 201      |                                    |
| `DELETE /projects/:id/team/:memberId`                | 404            | 404               | 404             | 204      | 404 another project's member id    |
| `POST /projects/:id/team/me/accept` / `reject`       | 404            | 409 (answered)    | 200 / 200       | 404      | 409 `INVITE_NOT_PENDING` twice     |
| `DELETE /projects/:id/team/me`                       | 404            | 204               | 404             | 404      | 404 rejected                       |
| `POST /me/notifications/:id/read` (another's id)     | 404, unchanged | —                 | —               | —        | the owner can still mark it        |
| `GET /me/notifications`, `/unread-count`, `read-all` | own only       | own only          | own only        | own only | read-all touches only own          |
| `GET /me/activities`                                 | own only       |                   |                 |          | no id to ask for                   |

Every endpoint is also 401 without a token and 429 once its budget is spent (a test per
route; the lookup has its own `lookup` budget and does not use the default).

## 5. Q4: who can read what

`projects/e2e/project-team-reads.int.test.ts` and `project-reads.int.test.ts`. A project
read by id (`GET /projects/:id`):

| Member status             | Private, not draft | Draft |
| ------------------------- | ------------------ | ----- |
| accepted                  | 200                | 404   |
| pending                   | 404                | 404   |
| rejected                  | 404                | 404   |
| removed or left           | 404                | 404   |
| member of another project | 404                | 404   |

Lists and discovery do not widen: the owner's `/users/:id/projects` for an accepted teammate
shows no private project; the teammate's own page shows accepted **published** projects with
`role: member`; their `/me/projects` and profile also show the private (never draft) projects
they are accepted on; pending and rejected never appear. The live name of a visible member
and the saved name of a private one are tested.

## 6. Transactions

A change and its notification, and a change and its activity, are one transaction. The
notification writer and the activity writer are each wrapped: `before` throws instead of
writing, `after` writes and then throws. The response is 500 and the project, the
membership, both feeds and the notification count are unchanged:

| Event                             | notification, before | notification, after | activity, before  | activity, after |
| --------------------------------- | -------------------- | ------------------- | ----------------- | --------------- |
| invite                            | PASS                 | PASS                | PASS              | PASS            |
| re-invite (rejected row)          | PASS                 | PASS                | covered by invite | covered         |
| accept                            | PASS                 | PASS                | PASS              | PASS            |
| reject                            | PASS                 | PASS                | PASS              | PASS            |
| leave                             | PASS                 | PASS                | PASS              | PASS            |
| project create / publish / delete | n/a                  | n/a                 | PASS              | PASS            |
| skills replace                    | n/a                  | n/a                 | PASS              | PASS            |

Plus a real MySQL error: a trigger that refuses every `notifications` insert makes an invite
answer 500 with no membership; with the trigger dropped the same call is 201. A control test
shows invite, accept and leave leave exactly one notification each when nothing fails, so
the proofs above cannot pass on a no-op.

## 7. Races

All with a barrier: a second connection holds a lock, the competing requests start, the test
waits until `performance_schema.data_lock_waits` shows them blocked, then releases. No sleeps.

| Race                                            | Outcome                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| double invite                                   | `[201, 409 ALREADY_MEMBER]`; one row, one notification                                                                |
| double accept                                   | `[200, 409 INVITE_NOT_PENDING]`; accepted; the owner told once                                                        |
| accept against reject                           | `[200, 409]`; the stored status and the one notification agree                                                        |
| accept against remove, remove first             | `[204, 404]`; no row, no notification                                                                                 |
| accept against remove, accept first             | `[200, 204]`; the owner's `team_accepted` stands, the row is gone                                                     |
| invite against the invitee deleting the account | 404, no row, no notification (the foreign-key error 1452 is mapped; its errno is also proved through the real driver) |
| invite against the owner deleting the project   | 404, no orphan row or notification                                                                                    |

Lock order everywhere: project row, then member row, then inserts. Accept, reject and leave
take the project `FOR SHARE`, owner writes `FOR UPDATE` (plan §4.3; the interplay was
"reasoned, not run" in the plan and is now run by the two accept/remove rows above).

## 8. Two-account journey over HTTP (local test tenant)

`scripts/team-roundtrip.mjs` against the **compiled server** (`node dist/api/main.js`,
`NODE_ENV=development`) on `127.0.0.1:3007`, an empty database, two accounts whose tokens
come from the test JWKS server (RS256, real signature, issuer and audience checks). 42
checks, 0 failures, in this order: both accounts differ; A creates a public and a private
project; the lookup finds B and not A; A cannot invite A (400); A invites B (pending); a second
invite is `ALREADY_MEMBER`; B has one more unread; B's notification is pending and renders from
saved names; B cannot list A's team, invite, remove (404 each); A cannot accept B's invitation
or mark B's notification (404), which stays unread; B accepts; a second accept is
`INVITE_NOT_PENDING`; B's notification reads accepted and B marks it read; A is told, with
`link` computed from the project; the public project is on A's profile as `owner` and on B's
as `member`; A's feed has `teamInvited`, `teamMemberJoined`, B's has `teamJoined`; on the
private project a pending then a rejected invitee reads 404; A invites B again (one row,
updated); B accepts and reads the private project; A removes B and B reads 404; B leaves the
public project and it is off B's profile; both projects deleted.

Stored afterwards: 0 projects, 0 team rows, 7 notifications (all read; no API deletes a
notification, they render from their saved names), 13 activities. The server log shows
`authorization` as `[redacted]`; no token or email appears in the script output or the log.

## 9. Real Auth0 two-account run — PENDING (needs Levon)

Goal: the same journey with real Auth0 access tokens for **two different accounts**, locally
and then on production. The first part proves the real token path for a second user (a
real `sub` for each); the second proves production after the Deploy of #54.

What I need from Levon:

1. **A second test account** in the same Auth0 tenant (a database-connection user or a
   second Google login is fine), signed in at least once so it exists, with its profile
   **public** (the default). The first account is the existing test user.
2. **One access token per account** (valid one hour), obtained the way
   [m4-verification.md](m4-verification.md) §9 describes: the `gradfolio` checkout with
   `AUTH0_AUDIENCE=https://api.gradfolio.app` in `.env.local`, `npm run dev -- -p 3011`, sign
   in at `/auth/login`, open `/auth/access-token`, copy `token`. Use a **private/other
   browser profile** for the second account, so the sessions do not mix.
3. Put them in the gitignored `.env` of `gradfolio-api-m5v` as `M5_TOKEN_A=eyJ…` and
   `M5_TOKEN_B=eyJ…` (never in chat), and tell the lead "tokens are in .env". Check
   without printing:
   `node -e 'const p=JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url"));console.log(p.iss,p.aud)' "$M5_TOKEN_A"`.
4. For the production run: #54 merged and its Deploy green (`/readyz` 200), so the activity
   checks have something to read.

Then (me): local first, with the real issuer and audience in the compose environment
(`AUTH0_ISSUER_BASE_URL=https://<tenant domain>/`, `AUTH0_AUDIENCE=https://api.gradfolio.app`,
[auth0-setup.md](auth0-setup.md) §7) on an empty volume:
`API_URL=http://127.0.0.1:3007 TOKEN_A=$M5_TOKEN_A TOKEN_B=$M5_TOKEN_B node scripts/team-roundtrip.mjs`,
then the same with `API_URL=https://gradfolio-api-1058577031182.us-east1.run.app`. The script
creates two projects titled `m5-roundtrip-<time>`, deletes them at the end, marks both
accounts' notifications read, and prints PASS/FAIL per step. What it leaves: a few **read**
notifications on both accounts about projects that no longer exist (no endpoint deletes a
notification) and their activities. Afterwards I check the log for the token, `sub` and
email, and record the output here.

## 10. Guards proved by removal

Each guard was removed (or weakened) and the named tests failed; then restored and the suite
re-run green. Pairs marked + back each other up (service check and SQL `WHERE`): removing
either alone changes nothing observable, removing both fails.

| Area          | Guard removed                                                                                                                                                                                                      | Failed                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| notifications | `user_id` on mark-one, mark-all, list, unread count                                                                                                                                                                | notifications.int (2, 2, 4, 4)                       |
|               | link readability check; actor visibility check                                                                                                                                                                     | notifications.int (4, 2)                             |
| team reads    | owner scope on the team list                                                                                                                                                                                       | team.int (2)                                         |
| visibility    | member status `accepted` (also lists); draft exclusion for members in reads and in lists; discovery using the read rule; profile private rule                                                                      | project-team-reads, profiles.int                     |
| account       | deletion of pending/rejected rows                                                                                                                                                                                  | account.int (2)                                      |
| team writes   | owner scope on the project lock; project scope on member delete                                                                                                                                                    | team-writes.int (2, 1)                               |
|               | D6 re-invite as UPDATE; self-invite; draft; team cap; private-profile invitee                                                                                                                                      | team-writes.int (1 each)                             |
|               | pending-only on accept/reject (+ service and SQL); accepted-only on leave (+ service and SQL)                                                                                                                      | team-writes.int (1 each)                             |
|               | notification outside the transaction; notification skipped                                                                                                                                                         | team-transactions, team-writes                       |
|               | project `FOR SHARE` on accept; the 1452 mapping                                                                                                                                                                    | team-races.int (1 each)                              |
| lookup        | public-only; excludes the caller; `LIKE` escaping; result limit; own budget; module order before `/users/:id`                                                                                                      | team-writes.int (1, 1, 1, 1, 1, 4)                   |
| activities    | feed `user_id`; strict registry; unknown key; publish transition; case-insensitive skills; skill cap; create/delete activity skipped or outside the transaction; page-size guard; each of the five team activities | activities tests (1–4 each)                          |
| cursors       | the `Date`-range bound on the shared time cursor                                                                                                                                                                   | time-cursor unit, activities and notifications (400) |
| config        | `NOTIFICATIONS_PAGE_SIZE` ≤ `_MAX` refine                                                                                                                                                                          | config.test                                          |

## 11. Defects found

- **#54, own pre-push:** the self-invite check ran before the ownership lock, so a stranger
  inviting themselves got 400 instead of 404. Moved after the lock; the matrix test caught it.
- **#54, Codex:** activity params and a key differed from the plan (`name`/`member`,
  `skillsAdded`); aligned to `projectName`/`memberName`/`skillName` and `newSkill` (a save
  that adds more than three skills is setup and writes none). A time cursor beyond the `Date`
  range reached the database as an invalid `Date`; now a 400.
- **#52, Codex:** the seed still wrote a non-English title, a message and a stored link; it now
  writes what the API writes. A missing failure test for the notification page-size refine.
- **M4 code, found in this milestone:** `ProjectService.signDetail` computed the signed team
  avatars and then discarded them; fixed in #52, and a linked member's photo is now the
  account's live avatar.
- Behaviour changes that moved existing tests, by design: `team[]` shows a visible member's
  live name (the saved row name only for a private or deleted account); `ProjectSummary.role`
  is `owner | member`; the profile lists a member's private project to the member.

## 12. Not verified

- **Real Auth0 tokens for two accounts** (§9). The local journey used the test JWKS server;
  the token path itself is the M2 code, exercised with real tokens for one user in M3 and M4.
- **Production after the Deploy of #54:** `/readyz` was 200 on 2026-10-09 (database
  reachable); that migration 0006 is applied is not read from outside, and follows from the
  Deploy workflow's migrate job succeeding.
- **Copilot:** every Copilot review failed on quota; Codex reviewed alone.
- The compose "container stack" run is covered by the CI job on each PR; the local HTTP run
  above used the compiled server directly, not the compose image.

## 13. Proposed tracker changes

- M5: 5.1–5.5 done after #54 merges; Q4 decided (plan §2: owner implicit, external named
  teammates accepted at once, accepted teammate reads a non-draft private project, a
  teammate may leave, pending/rejected invitations deleted with the account).
- Follow-ups: delete a notification; edit a member's role; a `projectUpdated` activity and
  the profile-view/connection activities (M6); `ProjectSummary.role` widening and the new
  activity keys need FE types and en/ru/am strings; the activity text placeholders are
  `projectName`, `memberName`, `skillName` (the dashboard mock's `{name}`/`{skill}` must follow).
