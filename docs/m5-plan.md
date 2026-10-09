# M5 plan: teams and notifications

Tracker tasks 5.1–5.5 (API half of 5.6/5.7). Decides **Q4**. Builds on M4
(`projectVisibleTo`, `lockProjectRow`, `inTransaction`, cursor pagination), all merged
(#44–#49). No M4 API PR is open, so there is no migration conflict: M5 takes **0006**.

Claims marked **run** were executed on 2026-10-09 against MySQL **8.4.11** (compose
project `gradfolio-m5`, port 3313), probe script outside the repo; each is re-proved by a
test in the PRs (§9). Frontend facts were read from `gradfolio@a15a658`, read-only.

Levon delegated Q4 and the delivery method to the recommendations below (via the M5
lead). Anything marked **Levon** is still his to overrule on this PR.

## 1. Decisions

| ID       | Decision                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q4       | §2: owner implicit; external teammates `accepted` with `user_id` NULL; accepted teammate reads a non-draft private project; a teammate may leave; account deletion cleans §2.4.    |
| Delivery | §6: unread count polled every 60 s while the tab is visible, plus on navigation and focus; list fetched on opening the bell. No SSE, no websockets.                                |
| Order    | Lock order everywhere: user row (if taken), **project row**, then member row, then notification/activity inserts. One order, so invite/accept/remove/leave cannot deadlock (§4.3). |
| Writes   | Every team write and its notification and activity rows share one `inTransaction`. Notification text is never stored in one language (§5.1).                                       |
| Limits   | Config, not literals: `PROJECT_MAX_TEAM` (20 rows per project, any status), `RATE_LIMIT_LOOKUP` (30 / window), `NOTIFICATIONS_PAGE_MAX` (50), `ACTIVITIES_PAGE_MAX` (50).          |

## 2. Q4: owner and teammate model

### 2.1 Facts (run)

| #   | Finding                                                                                                                                                                                                                  | Consequence                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Two rows with `user_id` NULL in one project insert fine (UNIQUE ignores NULLs).                                                                                                                                          | External teammates need no extra key. Duplicates among them are the owner's business; cap only.                                   |
| R2  | A second INSERT of (project, user) fails `1062 ER_DUP_ENTRY`. After `rejected`, `UPDATE … SET status='pending' … WHERE project_id=? AND user_id=? AND status='rejected'` matches 1 row; on a `pending` row it matches 0. | D6 confirmed. Re-invite is a guarded UPDATE; the WHERE clause is the "only from rejected" rule.                                   |
| R3  | With the row locked by an uncommitted `DELETE`, `UPDATE … WHERE id=? AND user_id=? AND status='pending'` blocks (seen in `data_lock_waits`), then affects **0** rows after the commit.                                   | Accept vs remove: one wins, the loser sees 0 rows and answers 404. Test uses the same poll-until-blocked barrier.                 |
| R4  | A change and its notification inside `BEGIN … ROLLBACK`: both gone (status stays `pending`, 0 notification rows).                                                                                                        | One transaction gives atomicity both ways. Proof test forces a failure after each of the two writes.                              |
| R5  | `DELETE FROM users` sets the member row's `user_id` to NULL **and leaves `status='pending'`**; the user's own notifications cascade away (0 left).                                                                       | A pending/rejected row of a deleted user would turn into a nameless pending "external". Account deletion must delete them (§2.4). |
| R6  | `DELETE FROM projects` removes team rows (cascade) but the **notification about the project stays** (no FK on `reference_id`).                                                                                           | Notification reads must tolerate a missing project (§5.2). `reference_id` has no FK and gets none (polymorphic).                  |
| R7  | `notifications.user_id` has an FK: inserting for a missing user is `1452`.                                                                                                                                               | A recipient deleted mid-transaction is a 404/rollback, not a half-write; the project lock order covers it (§4.3).                 |
| R8  | `EXPLAIN` of `WHERE user_id=? ORDER BY created_at DESC, id DESC` uses `idx_notifications_user` with **filesort**.                                                                                                        | Migration adds `(user_id, created_at, id)` and `(user_id, timestamp, id)` on activities.                                          |

### 2.2 Options and recommendation

| Question                     | Option A                                                                                                                                 | Option B                                 | **Recommendation**                                                                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                        | Implicit (`projects.user_id`), no member row                                                                                             | Owner also gets a member row             | **A.** One source of truth; no "owner row missing" state (D7 was exactly that). `team[]` and profile `role: 'owner'` already assume A. 1.14 makes the seed consistent.                                                            |
| Teammate without account     | Allowed: named only (`name`, `role`), no invite                                                                                          | Not allowed (spec §4 says approval)      | **A.** Row has `user_id` NULL, `status='accepted'` (nothing to approve), no notification. Owner adds and removes it. Accepted so it shows in `team[]`.                                                                            |
| Private project and teammate | Accepted teammate reads it (non-draft)                                                                                                   | Teammate sees public projects only       | **A.** Being on a team and not seeing the project is absurd. Pending/rejected invitees see nothing of it. A **draft** stays owner-only, and inviting is refused on a draft (`409 PROJECT_IS_DRAFT`). Teammates read, never write. |
| Pending invitee sees         | Title and owner name, inside their notification only                                                                                     | Nothing                                  | **A.** The notification snapshots `projectTitle` and `actorName` at invite time. No endpoint serves the project itself to a pending invitee.                                                                                      |
| May a teammate leave         | Yes: `DELETE /projects/:id/team/me` removes the row                                                                                      | No: only the owner removes               | **A.** Otherwise a teammate cannot take their name off a project (and the owner may be gone). The row is deleted, not set to `rejected`, so a later invite is a plain INSERT. The owner gets a `team_left` notification.          |
| Pending invitee withdraws    | Reject                                                                                                                                   | —                                        | Reject is the withdrawal. Rows are never soft-deleted.                                                                                                                                                                            |
| Account deletion             | Accepted rows keep `name`/`role`, `user_id` NULL, avatar cleared (3.6, unchanged); **pending and rejected rows of the user are deleted** | Keep all (R5: leaves ghost pending rows) | **A.** One added statement in `AccountService.delete`, inside the existing user lock.                                                                                                                                             |
| Project goes private         | Accepted teammates keep read access                                                                                                      | Revoke                                   | **A.** Private means "not public", not "owner only"; the owner removes a teammate to revoke.                                                                                                                                      |

### 2.3 Effect on M4 code (the one place it changes)

`projectVisibleTo(eb, viewerId)` gains a third branch for a signed-in viewer:
`EXISTS (SELECT 1 FROM project_team_members m WHERE m.project_id = projects.id AND m.user_id = viewer AND m.status='accepted')` **and** `is_draft = 0`. It stays a SQL predicate (a private row never leaves the database for someone else). It governs **direct reads** (`GET /projects/:id`). Lists keep their own rule:

- `GET /users/:id/projects` and browse/search (M6) stay published-only. M6 must **not** use the teammate branch for discovery; the plan states it here and `visibility.ts` exports it as a separate `projectReadableBy` so the two cannot be confused.
- `listProfileProjects` (profile): the profile's owner also sees the non-draft private projects they are an **accepted** member of; everyone else sees published only. Today's `m.status = 'accepted'` filter already keeps pending/rejected out (5.3).

### 2.4 Account deletion

`AccountService.delete` adds, after `lockUser` and the avatar clear:
`DELETE FROM project_team_members WHERE user_id = ? AND status <> 'accepted'`. Proof test: pending row of a deleted user is gone, accepted row stays with `user_id` NULL, `avatar_url` NULL.

## 3. Data model: migration 0006 (additive)

Safe while 0005's revision serves: nothing is dropped or tightened.

```sql
-- up (one DDL statement per step, as the runner requires)
ALTER TABLE notifications ADD COLUMN params JSON NULL;                       -- INSTANT
ALTER TABLE notifications MODIFY COLUMN type ENUM('team_invite','team_accepted','team_rejected',
  'project_verified','comment','contact_request','general','team_left') NOT NULL; -- append: no rebuild
CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at, id);
CREATE INDEX idx_activities_user_ts ON activities (user_id, timestamp, id);
```

Down reverses in the opposite order (the `team_left` rows are deleted first). `params` has
a shape CHECK (JSON object) like the other JSON columns (0002). Migration tests: applied
twice with nothing left, down then up gives an identical schema, `db:types` regenerated.

`notifications.title`/`message` are NOT NULL / NULL text in one language, which cannot be
right for en/ru/am. Decision: **`title` holds the stable English fallback, `message` stays
NULL, and the FE renders from `type` + `params`** (§5.1). The seed's four notifications get
`params` in 1.10's style (a seed update in PR (a)).

## 4. Team endpoints (PR b)

All under `/v1`, all in `OPERATIONS`, `http/team.http`, rate-limited (default budget; lookup has its own). Errors: 400 `VALIDATION_FAILED`, 401, 404 `NOT_FOUND`, 409 below, 429, 503.

| Method | Path                           | Who               | Result                                                                                                                         |
| ------ | ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/users/lookup?q=`             | token             | ≤ 8 `{id,name,headline,avatarUrl}`; own budget `lookup`. §4.2.                                                                 |
| GET    | `/projects/:id/team`           | owner             | All rows, every status: `{id,name,role,status,userId,avatarUrl,createdAt}`. Non-owner (teammate included): 404.                |
| POST   | `/projects/:id/team`           | owner             | Body `{userId, role?}` invite. 201 member (pending). Notifies the invitee.                                                     |
| POST   | `/projects/:id/team/external`  | owner             | Body `{name, role?}`. 201 member (accepted, `userId` null). No notification.                                                   |
| DELETE | `/projects/:id/team/:memberId` | owner             | 204. Any status. Accepted linked member: no notification (quiet); pending: the invitee's invite becomes "no longer available". |
| POST   | `/projects/:id/team/me/accept` | invitee           | 200 member (accepted). Notifies the owner.                                                                                     |
| POST   | `/projects/:id/team/me/reject` | invitee           | 200 member (rejected). Notifies the owner.                                                                                     |
| DELETE | `/projects/:id/team/me`        | accepted teammate | 204. Notifies the owner (`team_left`).                                                                                         |

Invitee actions are addressed by project id with the caller implied: no member id to guess, and "not your row" and "no such row" are the same 404.

Stable conflict codes (409): `ALREADY_MEMBER` (invite when the row is `pending` or `accepted`), `INVITE_NOT_PENDING` (accept/reject when the row is not pending), `TEAM_FULL` (`PROJECT_MAX_TEAM`), `PROJECT_IS_DRAFT`. Self-invite and inviting the owner: `400 VALIDATION_FAILED` (`userId` is the caller / the project's owner; same check, same code, no existence information). Unknown or non-public `userId`: **404** (identical to missing, so the endpoint is no oracle for private profiles).

### 4.1 Ownership in the statement (S4)

Every owner write begins `lockProjectRow(trx, callerId, projectId)` (M4: `WHERE id = ? AND user_id = ? FOR UPDATE`), false → `NotFoundError('project')`. Ownership is checked by the same locking statement that serialises the write; a non-owner never reaches an INSERT. Member DELETE adds `AND project_id = ?` so a member id of another project is 404. Invitee actions take the row by `(project_id, user_id = caller)`; there is no id from the client to confuse.

### 4.2 User lookup

`SELECT id, name, headline, avatar_url FROM users WHERE is_public = 1 AND id <> caller AND name LIKE 'q%'` (prefix, `escapeLike`, `q` 3–50 chars after trim, `LIMIT 8`, `ORDER BY name, id`). Never email, never contact email, never a private profile. Prefix-only and ≥ 3 characters, with a tight budget (30 per window, **own** `lookup` budget: the `search` budget is M6's and AGENTS.md forbids sharing), bound enumeration to what the public profile search (M6) already shows. Avatars are signed through `FileUrlService.read` like the profile's. The owner is excluded client-side and re-checked on invite.

### 4.3 Invite, re-invite, remove under concurrency

Invite (one transaction): `lockProjectRow` → `is_draft` check (read under the lock) → count rows ≤ cap → recipient: `SELECT … FROM users WHERE id = ? AND is_public = 1` (no lock; the FK enforces existence) → find row by `(project, user)`:

- none → INSERT `pending`;
- `rejected` → `UPDATE … SET status='pending', role=?, created_at=NOW() WHERE project_id=? AND user_id=? AND status='rejected'` (R2), rows must be 1;
- `pending`/`accepted` → 409 `ALREADY_MEMBER`.

Then the notification and activity inserts. The project lock serialises all owner writes on a project, so two simultaneous invites of the same user cannot both INSERT (the second sees the row), and the UNIQUE key is only the backstop (a stray `1062` maps to `ALREADY_MEMBER`). Accept/reject: `SELECT … FROM projects WHERE id = ? FOR SHARE` (same lock order, project first) → `SELECT … FROM project_team_members WHERE project_id=? AND user_id=? FOR UPDATE` → none: 404; not pending: 409 `INVITE_NOT_PENDING` → `UPDATE … WHERE id=? AND status='pending'` must match 1 → notification to the owner. Remove: project `FOR UPDATE` → `DELETE … WHERE id=? AND project_id=?`, 0 rows → 404. Accept vs remove is therefore serialised on the project row; whichever commits second sees the other's result (accept after remove: 404; remove after accept: removes the accepted row). Double accept: the second sees `accepted` → `INVITE_NOT_PENDING`. Deadlock retries use `inTransaction`; bodies are repeatable.

## 5. Notifications (PR a reads, PR b writes)

### 5.1 Shape

`Notification = {id, type, title, params, read, createdAt, link, invite}`:

- `type`: `team_invite | team_accepted | team_rejected | team_left` (others reserved, pass through as `general`);
- `params`: `{actorId?, actorName, projectId, projectTitle, role?}`: snapshots taken **in the writing transaction** from rows the recipient is entitled to know (the invitee may know title + owner name; the owner may know the teammate's name). No description, no private fields, no email;
- `title`: English fallback, `message` not sent; the FE renders `type` + `params` in the user's language (en/ru/am), as it does for activities;
- `link`: computed at read time, never stored (S12): `/projects/${projectId}` when the project **exists and the recipient may read it** (invite: not yet, so `null` while pending; accepted/owner events: yes), else `null`. Computed in the list query by `LEFT JOIN projects` + `projectReadableBy`. The stored `link` column is written `NULL` and ignored (the seed's stale links are cleared);
- `invite`: for `team_invite` only: `{status: 'pending'|'accepted'|'rejected'|'gone'}` from a `LEFT JOIN project_team_members ON project_id = reference_id AND user_id = recipient`; `gone` when the row or project no longer exists. So the bell shows Accept/Reject only while `pending`, and a stale invite shows "no longer available" instead of a 404 on click.

### 5.2 Deleted project / user renders safely

R6: the row survives; the join yields no project, so `link` and `invite` degrade as above while `params` still show the snapshot names. A deleted _actor_ leaves `actorName` in `params`; `actorId` is used only to link a profile when that profile is still visible (read-time check), else no link. No notification read dereferences a joined row without a null branch; tests delete the project and the actor and fetch.

### 5.3 Endpoints

| Method | Path                             | Result                                                                                                                                                    |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me/notifications?limit&cursor` | `{items, nextCursor}`, newest first, `(created_at, id)` cursor (M4's `cursor.ts`), `limit` ≤ `NOTIFICATIONS_PAGE_MAX`.                                    |
| GET    | `/me/notifications/unread-count` | `{count}` from `(user_id, is_read)`.                                                                                                                      |
| POST   | `/me/notifications/:id/read`     | 204. `UPDATE … WHERE id = ? AND user_id = caller`; 0 rows matched → 404 (S3). Idempotent: marking a read one matches 1 (run in M3: matched, not changed). |
| POST   | `/me/notifications/read-all`     | `{updated}`. `WHERE user_id = caller AND is_read = 0`.                                                                                                    |

Notification rows are never created over HTTP; only team services write them. No delete endpoint in v1 (follow-up).

## 6. Delivery to the FE

| Option                   | For                                                         | Against                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh on navigation    | No extra requests; trivial                                  | An open page never shows a new invite; a user on one page for an hour sees nothing                                                                                                                    |
| **Poll the count, 60 s** | One indexed `COUNT(*)`; works through the Next server (Q11) | Up to 60 s late; must pause when hidden                                                                                                                                                               |
| SSE                      | Instant                                                     | A held connection per tab on a 30 s request timeout and concurrency 40; the FE calls the API only from its server, so the stream would pass through Vercel functions; reconnect and auth-expiry logic |

**Recommendation: refresh on navigation and focus, plus a 60 s poll of the unread count only while `document.visibilityState === 'visible'`;** the list loads when the bell opens, and after accept/reject it refetches the count. Cost: Cloud Run already runs min 1 (`docs/deploy.md`), so the poll adds request CPU only: one tiny query per 60 s per open tab, i.e. tens of users ≈ well under 1 request/s, inside the 120/min default budget (one tab uses 1 + navigations). No new infrastructure. The FE plan agrees with this; websockets stay out of v1.

## 7. Teams on profile and lists (5.3)

The read side exists (accepted rows only; `team[]` on the project). M5 adds: the teammate branch of §2.3, `team[]` showing the **live** member name and avatar when the member's profile is visible (M4's `memberVisible`), else the row's name and no avatar; avatars of linked members now come from `users.avatar_url` through `FileUrlService.read`, which resolves the "M5 must" note in m4-plan §3.6 (row `avatar_url` stays NULL for externals; no new file registration). Pending and rejected never appear in any response but the owner's `GET /projects/:id/team`, and the invitee's own notification.

## 8. Activities (PR c)

`activities.type` is `project|profile`; text is `translation_key` + `translation_params` (i18n key, JSON object of strings/numbers); the FE renders. Decisions:

- **Feed is the actor's own** (`user_id` = who did it); `GET /me/activities?limit&cursor` (own, newest first). No public feed in v1 (M6's dashboard shows the viewer's own; matches the FE `ActivityFeed`). So the only viewer is the owner of the row.
- **Private data**: params carry only what that owner may already see: `projectId`, `projectName`, `memberName`, `count`; never descriptions, emails, or another user's private fields. Events about a project are written for its owner; for the teammate, `teamJoined` carries the project title they were just given read access to.
- Closed registry in code (`ACTIVITY_KEYS` → zod params schema); a write with an unknown key or bad params fails the transaction (tested). Keys: `projectCreated`, `projectPublished`, `projectDeleted`, `teamInvited`, `teamMemberJoined`, `teamMemberDeclined`, `teamJoined`, `teamLeft`, `newSkill`. `projectUpdated` is **not** written on every PATCH (spam); deferred with `profileViewed`/connections (no data source).
- Written in the same transaction as the event, from existing services (project create/publish/delete, skills add, team services). A forced failure after the event rolls the activity back, and the reverse (tested).
- `profile` events are limited to `newSkill` in v1; broader profile events are a follow-up.

## 9. Security properties and proofs

| Property                                                         | Proof (each is removed to watch it fail)                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner-only team writes, 404 for others (S4), in the locking stmt | Second user: 404 on invite, external add, remove, `GET team`; accepted teammate is 404 too. Remove the `userId` from `lockProjectRow` → test fails. |
| Invitee-only accept/reject, pending only                         | Owner, third user, non-invitee: 404; accepted/rejected row: 409 `INVITE_NOT_PENDING`. Remove `status='pending'` → fails.                            |
| No self/owner invite; no private/unknown target                  | 400 / 404 tests; private profile target gives the same body as an unknown id.                                                                       |
| Duplicate invite, re-invite                                      | `ALREADY_MEMBER`; rejected → pending is an UPDATE (row id unchanged, `created_at` bumped). INSERT variant fails on 1062.                            |
| Lookup leaks nothing                                             | Private profile absent; no email field in the response (key-set test); 31st request → 429; `q` < 3 → 400.                                           |
| Notification scoping (S3)                                        | Other user's id: mark read → 404 and row unchanged; list shows only own; unread count own; read-all touches only own.                               |
| Same-transaction notifications and activities                    | Inject a failure after the change (change rolled back, 0 notifications) and after the notification (change rolled back) — both directions.          |
| Races under barrier (poll `data_lock_waits`, never sleep)        | Double accept, accept vs remove, double invite, invite vs account deletion of the invitee (`1452` not leaking).                                     |
| Links from real ids (S12)                                        | Link built from `projectId`; deleted project → `null`; no stored link read.                                                                         |
| Visibility                                                       | Accepted teammate reads a private (non-draft) project; pending, rejected, removed, and a stranger get 404; a draft is 404 for the teammate.         |
| Account deletion                                                 | §2.4 test.                                                                                                                                          |

Every endpoint: `OPERATIONS`, a request in `http/team.http` / `notifications.http` / `activities.http`, an ownership test and a second-user-404 test, rate limit (default budget; `lookup` for the lookup).

## 10. What the FE needs (for the FE plan; no FE change here)

- A `Notification` type from the generated types (Q5); the bell renders `type` + `params` in en/ru/am; accept/reject act on `invite.status === 'pending'` via `POST /projects/:id/team/me/{accept,reject}` (`params.projectId`).
- Team section: `GET /projects/:id/team` (owner), lookup (debounced, ≥ 3 chars), invite, external add, remove with a confirm naming the person.
- `TeamList` and `team[]`: `userId` null means no profile link (already so). Mock `TeamMember` in `project.mock.ts` goes with 4.10 (done).
- Dashboard `ActivityFeed` already takes `translationKey`/`translationParams`; keys in §8 need en/ru/am strings.
- Nothing exists today: no team UI, no `Notification` type.

## 11. PR breakdown

| PR   | Content                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| plan | This document.                                                                                                                                                                                                  |
| (a)  | Migration 0006 + types; `projectReadableBy` and the teammate branch; `GET /projects/:id/team`; notifications list, unread count, mark one, mark all; seed `params`; OpenAPI, `http/`; account-deletion cleanup. |
| (b)  | Lookup, invite, external, remove, accept, reject, leave, with notifications in the same transaction; barrier races; transaction proofs.                                                                         |
| (c)  | Activities table use: registry, writers in existing services, `GET /me/activities`.                                                                                                                             |
| then | `docs/m5-verification.md`: fresh clone, coverage ≥ 90 %, integration, second-user matrix, real two-account Auth0 run (Levon's second account), prod `/readyz`.                                                  |

## 12. Out of scope

Email or push for notifications; deleting notifications; editing a member's role after invite; public activity feed; `projectUpdated` activity; invite expiry; team size beyond `PROJECT_MAX_TEAM`; Auth0 account deletion; reordering team members (`sort_order` stays 0, order by `created_at, id`).

## 13. Not verified in this plan

- FOR SHARE (accept) vs FOR UPDATE (invite/remove) lock interplay was reasoned from InnoDB rules and R3, not run end to end; PR (b)'s barrier tests are its proof.
- The cost line in §6 is arithmetic from `docs/deploy.md`, not a measured load.
- Real Auth0 tokens for two accounts: needs Levon's second account.
