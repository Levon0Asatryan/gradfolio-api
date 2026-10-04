# M3 plan: profiles

Tracker tasks 3.1–3.6, the API half of 2.14, and what 2.12 needs from the API.
Decides **Q3** (privacy, profile part) and **Q5** (contract and types). Two product
calls are Levon's: **Q3** and **3.6**.

Claims marked **run** were executed on 2026-10-04 against MySQL **8.4.11** (compose
project `gradfolio-m3`, port 3309), Node 24.20, Kysely 0.29, mysql2 3.24.4, zod 4.6.5,
@nestjs/throttler 6.7.1. Probe scripts ran outside the repo (scratchpad); their
behaviour is re-proved by tests in the PRs (§5). Frontend facts were read from
`gradfolio@a15a658`, read-only.

## 1. Decisions

| ID         | Decision                                                                                                                                                                                                                                                                           | Evidence  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Q3         | **Levon decides**, see §2. Recommended: private profile = 404 to everyone but the owner. One predicate (`visibleTo`) so a change is one function and its tests.                                                                                                                    | §2        |
| Q5         | `openapi.yaml` → `openapi-typescript` in the frontend, pinned to an API commit, regenerated and diffed in frontend CI. See §3.                                                                                                                                                     | §3        |
| 3.6        | **Levon decides**, see §2. Recommended: in v1, `DELETE /v1/me`, database data only; Auth0 account stays.                                                                                                                                                                           | P6, P7    |
| Write lock | Every write that depends on a user's _set_ of rows (create, reorder, skills, delete account) first takes `SELECT … FROM users WHERE id = ? FOR UPDATE`. One order everywhere: user row, then section rows, then `terms`.                                                           | P3–P5, P7 |
| Row count  | `numUpdatedRows` is the **matched** count (1 for a same-value UPDATE), so "0 rows → 404" never fires on a no-op edit.                                                                                                                                                              | P1        |
| Contact    | New column `users.contact_email` (public, default NULL). `users.email` (Auth0 pre-fill) stays private. Pre-filling a public field from the login would publish an address the user never chose to show.                                                                            | §4.1      |
| Onboarding | New column `users.onboarded_at`; `GET /v1/me` gains `onboarded`; `POST /v1/me/onboarding/complete` sets it. Chosen over deriving "incomplete profile" from data: skipping and finishing both end onboarding, and a derived rule would re-prompt a user who left a section empty.   | §4.4      |
| Ordering   | New rows go to the **top** (`MIN(sort_order) - 1`), matching the frontend (`[newItem, ...items]`). Reorder rewrites `0..n-1`. Reads: `ORDER BY sort_order, id`.                                                                                                                    | P2        |
| Text       | Every profile text field is **plain text**. No HTML anywhere in M3; the frontend must render it as text.                                                                                                                                                                           |           |
| Limits     | Config, not literals: `PROFILE_MAX_SECTION_ITEMS` (50), `PROFILE_MAX_SKILLS` (100), `PROFILE_PROJECTS_LIMIT` (50). Checked inside the user lock, so concurrent creates cannot overshoot. Without a cap a user can fill the 1 GB free tier; the rate limit bounds speed, not total. |           |

## 2. Questions for Levon

### Q3: who can read a private profile?

The spec's "direct link or logged-in users" sentence (§6) is about **projects**; for
profiles it only says they "might be public by default". `users.is_public` exists.

| Option                    | Private profile answers                                     | For                                                                                       | Against                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Owner only**         | 404 to everyone else, anonymous included; not in search     | Simplest to reason about and to test; no existence oracle; "private" means private        | A student cannot hand a recruiter an unlisted link; they must go fully public                                                             |
| B. Logged-in users        | 200 to any signed-in user, 404 to anonymous; not in search  | Matches the spec wording                                                                  | Sign-up is free (Google), so "logged-in" is a speed bump, not a boundary; a recruiter must create an account to see a link they were sent |
| C. Direct link (unlisted) | 200 to anyone who has the id, hidden from search and browse | Matches `gradfolio-sql` docs; ids are random v4 UUIDs (`randomUUID`), so unlisted is real | Ids leak through team lists, referrers and shared screenshots; nothing is actually restricted                                             |

**Recommendation: A for profiles.** Anonymous callers still read public profiles
(spec §8d: a recruiter clicks a link). Projects (M4) take the same decision; if
Levon wants B or C for projects only, it is a different predicate in M4, not a
rework here. A team member whose profile is private still appears by name on a
public project; their profile link 404s (a Q4 / M5 detail).

**Levon decides.**

### 3.6: account deletion in v1?

| Option                              | What happens                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **In, database only (recommended)** | `DELETE /v1/me` removes the user and everything below it by cascade (P6). Team rows on other people's projects keep `name` and `role`; `user_id` becomes NULL; `avatar_url` is cleared (it is the person's photo). The Auth0 login remains; signing in again creates a blank account (Q7). The frontend signs the user out after the call. |
| In, plus Auth0                      | Also delete the Auth0 user through the Management API. Needs an M2M application with `delete:users`, a new secret, and a failure mode (database gone, Auth0 not). Follow-up if wanted.                                                                                                                                                     |
| Out of v1                           | Drop 3.6 and the account-page button (3.9). The cascades stay untested in the API.                                                                                                                                                                                                                                                         |

Deletion is small now (the foreign keys already cascade) and expensive to add after
M4 puts files in storage: M4 must then delete blobs too. **Levon decides.** If out,
PR (c) disappears.

## 3. Q5: contract and type sharing

**Mechanism.** The frontend runs `openapi-typescript` (7.13.0; run on today's
`openapi.yaml`: it emits `string | null` for nullable fields and one entry per
operation) against `openapi.yaml` **at a pinned API commit**. The yaml is fetched
from `raw.githubusercontent.com/Levon0Asatryan/gradfolio-api/<sha>/openapi.yaml`
(the repository is public). The generated file is committed in the frontend. The
frontend calls through its own typed client (`src/lib/api/client.ts`, M2) using
`paths`/`components` types; no runtime validation of responses.

**Where drift is caught.**

| Drift                                        | Caught by                                                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API code ≠ `openapi.yaml`                    | API CI `openapi:check`; `document.test.ts` compares routes both ways (exists). New: request bodies and path parameters are documented from the same zod schemas the pipe validates with       |
| Frontend generated file hand-edited or stale | Frontend CI job: regenerate from the pinned sha, `git diff --exit-code`                                                                                                                       |
| API moved on, frontend still on an old sha   | Frontend bumps the sha (`npm run api:types -- <sha>`); the compiler then fails wherever the contract changed. A weekly non-blocking frontend job regenerates from `main` and reports the diff |
| Breaking change merged without the frontend  | Not blocked automatically. The API PR description lists changed operations; the compiler finds the rest on the bump. A breaking-change linter (oasdiff) is a follow-up at this scale          |

**Change in the API to support it.** `buildOpenApiDocument` today documents
responses only and inlines every schema. M3 adds, in PR (a):

- `Operation.params` and `Operation.body` (zod), emitted as `parameters` and
  `requestBody`;
- named component schemas (`Education`, `Experience`, `Certification`,
  `ProfileProject`, `Profile`, …): a zod schema with `.meta({ id })` emits
  `#/definitions/<id>` (run, zod 4.6.5); the builder hoists those into
  `components.schemas` and rewrites the `$ref`s. A test fails on any `$ref` that
  does not resolve and on any leftover `#/definitions`.

Task 2.9's "generated types wait for Q5 (M4)" moves up: 3.8 needs them in M3.

## 4. Investigation

### 4.1 Frontend types vs. columns (investigation §4.3, completed)

| Frontend (`profile.mock.ts`, components)                                                            | Column / API                                      | Mismatch and handling                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id: "u_001"`, `"edu_<Date.now()>"`                                                                 | UUIDs, server-generated                           | Frontend must replace its temporary id with the id in the `POST` response.                                                                                                                                                                                                                                                                                                |
| `name`, `headline`, `location?`, `verified`                                                         | `users.*`                                         | `location` → `null` when absent.                                                                                                                                                                                                                                                                                                                                          |
| `email?` (header contact button)                                                                    | **new** `users.contact_email`                     | Not `users.email`. Absent until the user sets it; onboarding can offer "use my login email".                                                                                                                                                                                                                                                                              |
| `avatarUrl: string` (required)                                                                      | `avatar_url` nullable                             | API returns `null`; frontend shows initials. **Also:** `next.config.ts` allows only pravatar and unsplash for `next/image`, but M2's pre-fill stores the provider's picture (Google, GitHub, LinkedIn hosts). Frontend must allow those hosts or render unoptimized; do not open `remotePatterns` to `**` (the Next.js image optimizer would fetch any URL a user types). |
| `socialLinks{github,linkedin,twitter}`; no `website`, no `bio`                                      | `github`, `linkedin`, `twitter`, `website`, `bio` | API: `links{github,linkedin,twitter,website}`, `bio`. Frontend type gains two fields (3.8).                                                                                                                                                                                                                                                                               |
| `Education{institution,degree,field,startYear,endYear?,description?,highlights?}`                   | `education` table, same names                     | `?` ↔ `null`; `highlights` absent ↔ `[]` (API never returns null arrays).                                                                                                                                                                                                                                                                                                 |
| `Experience{…, end?, achievements?, skills?}`; `end` edited as free text, `"Present"` ↔ `undefined` | `experience`; `end` NULL = present                | Frontend sends `null` for Present and `YYYY-MM` otherwise; anything else is 400.                                                                                                                                                                                                                                                                                          |
| `Certification{…, date, credentialUrl?}`                                                            | `certifications`                                  | Same.                                                                                                                                                                                                                                                                                                                                                                     |
| `skills: string[]`, de-duplicated case-sensitively in the browser                                   | `user_skills` + `terms`                           | API de-duplicates case-insensitively and fixes the spelling (first spelling wins, M1). Frontend replaces its list with the response.                                                                                                                                                                                                                                      |
| `Project{name, category(4), tags, href?, attachments?, team?}`                                      | `projects.title`, 6-value enum, `project_tags`    | Profile carries a **summary** (id, title, summary, category, status, heroImageUrl, tags, isPublic, role). No attachments/team (project page, M4). `name`→`title`; `href` dropped (route is `/projects/:id`).                                                                                                                                                              |
| `phone`, `birthday`                                                                                 | columns exist; no UI                              | Never in any response; not settable in M3.                                                                                                                                                                                                                                                                                                                                |

### 4.2 How the frontend edits today (decides the shapes)

- **Header:** `EditableText` per field; `onUpdate(field, value)` for `name`,
  `headline`, `location`, `avatarUrl`. → `PATCH /v1/me/profile` is a **partial**
  update, one field at a time is the normal case.
- **Sections:** the lists hold the whole array in state. Add = `[newItem, ...items]`
  with blank strings; edit = one field of one item (`handleUpdateItem(id, field,
value)`); delete = filter. → item `POST` / partial `PATCH` / `DELETE`. There is
  **no drag-to-reorder UI** today; the reorder endpoints exist for the task and for
  M4, not for an existing screen.
- **Skills:** add and delete chips, whole list in state. → `PUT /v1/me/skills`
  with the whole list.
- **Consequence for 3.7:** a blank new item (empty institution, degree, field) must
  not be `POST`ed; the API requires non-empty required fields, because a blank row
  would show on a public profile. The frontend POSTs when the item is valid (a
  dialog or a "Save" per item), or keeps a local draft until then. Blank
  _nullable_ text (`description`, `location`, …) is stored as `NULL`.
- **Own profile:** `/profile` hardcodes `/profile/u_001`; `isOwnProfile = id ===
"u_001"`. → `GET /v1/me` gives the id; `GET /v1/users/:id` returns `isOwner`
  (2.12), so the frontend never compares ids.

### 4.3 Runs on MySQL 8.4.11 (P1–P7)

| #   | Run                                                                                                                                  | Result                                                                                                                                                                                                                                                                                                               | Decision / test                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | `UPDATE` setting a column to its current value; `UPDATE`/`DELETE` matching nothing, through Kysely `numUpdatedRows`/`numDeletedRows` | `1`, `0`, `0`: the pool counts matched rows                                                                                                                                                                                                                                                                          | "0 rows → 404" is safe for no-op edits. A test edits an item to identical values and expects 200.                                                            |
| P2  | One `UPDATE … SET sort_order = CASE id WHEN … END WHERE user_id = ? AND id IN (…)`; then an insert at `MIN - 1`                      | 3 rows updated in one statement; order `I3,I1,I2`; the new row at `-1` sorts first (`INT` is signed)                                                                                                                                                                                                                 | Reorder = one statement. Create uses `MIN - 1`.                                                                                                              |
| P3  | Reorder **without** a lock: read the set `{a,b}`, a concurrent create of `c` commits, reorder writes                                 | The stale set was accepted (`ids == caller's set` held only for the old snapshot)                                                                                                                                                                                                                                    | The set check must run under the user lock. Test: create blocked by a barrier while reorder holds it.                                                        |
| P4  | Same, **with** `SELECT … FROM users … FOR UPDATE` in both; barrier `performance_schema.data_lock_waits` shows the create queued      | Create waited; final order `new:-1, I2:0, I1:1`                                                                                                                                                                                                                                                                      | Lock accepted.                                                                                                                                               |
| P5  | Two replace-all skills on a user with none: both `DELETE` the empty range, then both `INSERT`                                        | **No lock:** the second insert gets `1213 ER_LOCK_DEADLOCK` (empty-range gap locks); `inTransaction` would retry. **With the user lock:** the second waits, no deadlock, final list is exactly the later caller's                                                                                                    | Lock plus `inTransaction`. Test: barrier on the lock wait, then assert the final list equals one caller's list, never a mix.                                 |
| P6  | Delete a user that has every kind of child, plus team rows on someone else's project                                                 | `education, experience, certifications, user_skills, projects (own), integrations, notifications (own), activities` all cascade. The team row on another's project survives with `user_id NULL`, `name` kept, **`avatar_url` kept**; own project's team rows cascade away. A notification sent to another user stays | Deletion clears `avatar_url` on the user's team rows first. A notification in another's inbox that names the user is M5's concern (recorded as a follow-up). |
| P7  | Delete in one transaction while another transaction creates a child, with and without the lock                                       | **Locked:** the create's `SELECT … FOR UPDATE` finds 0 rows → `NotFoundError`. **Unlocked:** `1452 ER_NO_REFERENCED_ROW_2` (would be a 500)                                                                                                                                                                          | `lockUser` throws NotFound when the row is gone. Test under a barrier.                                                                                       |

### 4.4 The code this touches

- `AccessTokenGuard` makes every non-`@Public()` route need a token; a public route
  gets no `req.auth`. `GET /v1/users/:id` must be readable anonymously **and** know
  the caller when a token is sent → new `@OptionalAuth()` (§5.1).
- `CurrentUserGuard` creates the row for any authenticated request (Q7). After a
  deletion, a still-valid token recreates a blank account on its next request.
  The frontend signs out after the call; a test records the behaviour.
- `canonicalizeTerms` locks `terms` in sorted order (M1). Skills and
  `experience.skills` go through it, always after the user lock.
- `COLUMN_LIMITS` + `columns.int.test.ts` fail until `users.contact_email` is added.
  `types.generated.ts` is regenerated (`db:types`; CI checks it).
- Rate limits are per route per caller (m2-plan §2.6, run): the new routes do not
  share a budget with each other. Anonymous callers are keyed by address. The
  frontend calls from its server (Q11), so anonymous profile views share the
  frontend's egress address(es): 120/min each by default. Fine at this scale;
  a tracker follow-up if public traffic ever matters.

### 4.5 Comparable systems and published problems

- **OWASP API Security 2023, API3 (Broken Object Property Level Authorization):** both
  excessive exposure and mass assignment. Consequences here: public responses select
  an explicit column list (never `selectAll`), and request schemas are `strict`
  (unknown keys → 400) so `verified`, `email`, `auth0Id`, `phone`, `birthday`, `id`
  cannot be written through `PATCH`. Each is proved by removal (§6).
- **API1 (BOLA):** every `:id` is scoped by `user_id = caller` in the same statement;
  a foreign id answers 404, indistinguishable from a missing one.
- **LinkedIn / GitHub:** both have a profile-visibility control that makes a profile
  invisible to non-members or anonymous visitors (LinkedIn's help page names a
  "Visibility" section but the fetched page gave no option list, so this is not
  cited for specifics). Not used to decide Q3.
- **Account deletion:** GDPR Art. 17 is not binding for coursework but is the
  expectation users bring; the plan treats "my data is gone, team rows keep a
  name" as the contract.

## 5. Design

### 5.1 Pipeline change: optional authentication

`@OptionalAuth()` (metadata). `AccessTokenGuard`: on such a route, **no
`Authorization` header** → continue anonymous; a header that is present is verified
exactly as elsewhere, so a bad or expired token is still **401**, never silently
anonymous. `CurrentUserGuard` skips when `req.auth` is unset. Rate limit unchanged.

### 5.2 Data model (migration `0005_profile_fields`)

```
ALTER TABLE users
  ADD COLUMN contact_email VARCHAR(255) NULL,
  ADD COLUMN onboarded_at  DATETIME NULL;      -- one atomic ALTER, skip-if guard
```

Down migration drops both. No backfill: existing accounts see onboarding once.
`COLUMN_LIMITS['users.contact_email'] = chars(255)`; `types.generated.ts` regenerated;
the demo seed sets `onboarded_at` and `contact_email`.

### 5.3 Endpoints

All under `/v1`, all in `OPERATIONS`, all with an entry in `http/`, all behind the
default per-route rate limit. Errors: 400 `VALIDATION_FAILED`, 401, 404 `NOT_FOUND`,
409 (below), 429, 503.

| Method | Path                                        | Auth     | Result                                                               |
| ------ | ------------------------------------------- | -------- | -------------------------------------------------------------------- |
| GET    | `/users/:id`                                | optional | Profile (§5.4). 404 if missing **or not visible to the caller (Q3)** |
| GET    | `/me/profile`                               | token    | Header fields (below)                                                |
| PATCH  | `/me/profile`                               | token    | Partial update; returns the header                                   |
| POST   | `/me/{education,experience,certifications}` | token    | 201 + item; 409 `LIMIT_REACHED` at the cap                           |
| PATCH  | `/me/{…}/:id`                               | token    | Partial; returns the item; 404 if not the caller's                   |
| DELETE | `/me/{…}/:id`                               | token    | 204; 404 if not the caller's                                         |
| PUT    | `/me/{…}/order`                             | token    | Body `{ids}`; returns the section in the new order                   |
| PUT    | `/me/skills`                                | token    | Body `{skills}` (whole list); returns the canonical list             |
| POST   | `/me/onboarding/complete`                   | token    | `{onboarded: true}`; idempotent; keeps the first timestamp           |
| DELETE | `/me`                                       | token    | 204. Only if 3.6 is in                                               |
| GET    | `/me` (exists)                              | token    | Gains `onboarded: boolean`                                           |

**Header** (`GET`/`PATCH /me/profile`): `id, name, headline, bio, location,
avatarUrl, contactEmail, isPublic, links{github,linkedin,twitter,website}`.
`PATCH` accepts any non-empty subset of those except `id`; unknown keys → 400;
`null` clears a nullable field; `links` merges per key. `name` non-empty (≤255
chars), `headline` ≤500 (may be empty), `bio` ≤ TEXT bytes, link fields `http(s)`
URLs ≤500 chars, `avatarUrl` an `http(s)` URL (**URL-only until M4**; the server
never fetches it), `contactEmail` a valid address ≤255. Validators are M1's
(`columnString`, `httpUrl`, `yearMonth`, `stringList`, `termList`).

**Items** (`POST` requires all required fields; `PATCH` a non-empty subset, merged
with the stored row and validated as a whole, so cross-field rules hold):

- education: `institution, degree, field` (non-empty, ≤500), `startYear` (int
  1900–2100), `endYear` (null or ≥ `startYear`), `description` (null or text),
  `highlights` (≤20 non-empty strings).
- experience: `title, organization` (≤500), `start` (`YYYY-MM`), `end` (null or
  `YYYY-MM` ≥ `start`), `summary` (text, may be empty), `achievements` (≤20
  strings), `skills` (≤30 terms, passed through the terms registry).
- certifications: `name, issuer` (≤500), `date` (`YYYY-MM`), `credentialUrl`
  (null or `http(s)` URL).

**Create**: `inTransaction`: `lockUser` → count (≥ cap → 409) → `MIN(sort_order) - 1`
→ insert with `newId()`.
**Patch**: `inTransaction`: `SELECT … WHERE id = ? AND user_id = ? FOR UPDATE`
(none → 404) → merge → validate → `UPDATE … WHERE id = ? AND user_id = ?`;
`numUpdatedRows = 0` → 404 (P1: no-ops return 1). The row lock serializes two
concurrent patches of one item, so a cross-field rule cannot be broken by two
halves.
**Delete**: `DELETE … WHERE id = ? AND user_id = ?`; 0 → 404.
**Reorder**: `inTransaction`: `lockUser` → `SELECT id … WHERE user_id = ? FOR UPDATE`
→ duplicates in the body → 400; any submitted id not in the caller's set → **404**
(a foreign, deleted or unknown id are indistinguishable); same ids but set
incomplete → **409 `ORDER_STALE`** (another tab added one) → one `CASE` UPDATE,
matched rows must equal `n`, else throw (rolls back). Skills have no separate
reorder: `PUT /me/skills` order is the order. The helper takes the table and
owner column so M4 can reuse it for attachments.
**Skills**: `inTransaction`: `lockUser` → `setUserSkills` (M1) → return list. Empty
list clears. Over `PROFILE_MAX_SKILLS` → 400.
**Onboarding**: `UPDATE users SET onboarded_at = COALESCE(onboarded_at, UTC_TIMESTAMP()) WHERE id = ?`. Matched rows must be 1, else 404 (P1: a repeat call matches 1). The same rule holds for `PATCH /me/profile`: a `users` UPDATE that matches 0 rows (account deleted after the guard resolved it) is a 404, never a 200.
**Delete account** (if in): log `account deletion started` (user id only) →
`inTransaction`: `lockUser` → `UPDATE project_team_members SET avatar_url = NULL
WHERE user_id = ?` → `DELETE FROM users WHERE id = ?` (0 → 404) → log `completed`.
The started line is written **before** the change, so the record does not depend on
the commit.

### 5.4 `GET /users/:id`

`SELECT <explicit columns> FROM users WHERE id = ? AND visibleTo(viewer)` with
`visibleTo` = `is_public = 1 OR id = <viewer id>` (option A). A miss is 404 with
the same body as a nonexistent id. Only then are the sections read (education,
experience, certifications by `sort_order, id`; skills; projects).

Response: `id, name, headline, bio, location, avatarUrl, verified, contactEmail,
links, isOwner, isPublic, education[], experience[], certifications[], skills[],
projects[]`. Never: `auth0Id`, `email`, `phone`, `birthday`, any integration
column, `createdAt`/`updatedAt`.

**Projects** (summaries, newest first, ≤ `PROFILE_PROJECTS_LIMIT`):
own projects + projects where the user is a team member with `status = 'accepted'`.
Everyone sees only `is_public = 1 AND is_draft = 0`. The **owner** also sees their
own private and draft projects (flagged `isPublic`, `isDraft`); a project they
belong to but do not own stays public-only until Q4/M4 says otherwise.
`role: 'owner' | 'member'`. Tags come from `project_tags` in one query for all
shown projects. Rows are `{id, title, summary, category, status, heroImageUrl,
tags, role, isPublic}`; a private project's data never leaves the database for a
non-owner because the predicate is in the SQL, not applied afterwards.

### 5.5 Files

```
src/api/profiles/                 profiles.module.ts, profiles.controller.ts (GET /users/:id)
  my-profile.controller.ts        GET/PATCH /me/profile
  education.controller.ts · experience.controller.ts · certifications.controller.ts · skills.controller.ts
  dto/                            zod schemas (request + response, with .meta({id}))
  services/profile.service.ts · section.service.ts (shared create/patch/delete/reorder flow)
  repositories/                   profile · education · experience · certification · project-summary
  utils/user-lock.ts · visibility.ts · reorder.ts
src/api/auth/decorators/optional-auth.decorator.ts
src/api/me/                       + onboarding, + DELETE (c)
src/core/db/migrations/0005_profile_fields.{up,down}.sql
```

## 6. Security properties and how each is proved

Every proof is a test **seen failing** with the guard removed (recorded in
`m3-verification.md`).

| Property                                                                                                                 | Test                                                                                                                                                                                                                        | Guard removed                                   |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Private profile: 404 for other user and anonymous, 200 for owner (Q3 as decided); same body as a missing id              | e2e matrix: owner / other / anonymous × public / private                                                                                                                                                                    | drop `visibleTo` from the SQL                   |
| No private field in any public response                                                                                  | seed `phone, birthday, auth0Id, email`, an integration with tokens; scan every JSON key and value of every read as anonymous, other, owner; plus a scan of `openapi.yaml` for forbidden property names outside `GET /v1/me` | add `phone` to the select list                  |
| Mass assignment: `verified, email, auth0Id, phone, birthday, id, createdAt, onboardedAt` rejected by `PATCH /me/profile` | e2e, each key → 400, row unchanged                                                                                                                                                                                          | make the schema non-strict                      |
| Second user: 404 on `PATCH`/`DELETE` of an item, and on `PUT …/order` with a foreign id; nothing changed                 | e2e per section (×3 × 3 operations); repository test calls the function with the wrong `user_id` and gets "none"                                                                                                            | remove `user_id` from each `WHERE` (separately) |
| Same-value `PATCH` is 200, not 404                                                                                       | e2e                                                                                                                                                                                                                         | n/a (guards against a wrong fix of the above)   |
| Reorder takes exactly the caller's set; atomic                                                                           | stale set (create under barrier) → 409; foreign id → 404; mid-way failure rolls back (inject a failing statement)                                                                                                           | drop the set check; drop the lock               |
| Skills replace-all is one transaction, serialized                                                                        | barrier: second PUT queued on the user lock; final list is exactly one caller's; a failing insert leaves the old list                                                                                                       | drop the transaction; drop the lock             |
| Create cap holds under concurrency                                                                                       | two creates at cap − 1 behind a barrier: one 201, one 409                                                                                                                                                                   | drop the lock                                   |
| Delete vs. create: no 500                                                                                                | barrier (P7)                                                                                                                                                                                                                | drop `lockUser`'s not-found                     |
| Deletion cascades; team rows keep name, lose avatar and `user_id`; other users' rows untouched                           | e2e + int over every table                                                                                                                                                                                                  | drop the avatar `UPDATE`; drop a cascade FK     |
| URL fields reject `javascript:`/`data:`; text stays inert                                                                | validators (M1) exercised through each endpoint                                                                                                                                                                             | n/a (M1 guard; endpoint wiring tested)          |
| Optional auth: bad/expired token on `/users/:id` → 401, no header → anonymous                                            | e2e                                                                                                                                                                                                                         | treat any header failure as anonymous           |
| Every new route is rate-limited, per route                                                                               | parameterized e2e with `RATE_LIMIT_DEFAULT=2`: third call 429; exhausting one route leaves another at 200                                                                                                                   | mark a route `@SkipThrottle`                    |
| Contract is the code                                                                                                     | `document.test.ts` (routes both ways), new: every `$ref` resolves, bodies and params present, `openapi:check`                                                                                                               | n/a                                             |
| Race tests use a barrier                                                                                                 | `waitForLockWaiters`, never a sleep                                                                                                                                                                                         | n/a                                             |

Real Auth0 token run at the end (§8): every section edited over HTTP, stored rows
checked.

## 7. Out of scope

Avatar upload and file storage (M4, Q6). Project create/edit/detail (M4). Search
and browse (M6; they will reuse `visibleTo`). Teammate model (Q4, M5). Verification
of education/certifications (optional spec). Auto-sorting sections by date.
`phone`/`birthday` editing. Auth0 Management API calls (unless Levon chooses "plus
Auth0"). Per-viewer analytics. Breaking-change linting of the contract.

## 8. Pull requests

1. **This plan** (docs only; one review round, then merge).
2. **(a) Contract and reads.** Migration 0005 + types + seed; `@OptionalAuth`;
   OpenAPI builder (bodies, params, component schemas); `GET /users/:id`;
   `GET`/`PATCH /me/profile`; `GET /me` `onboarded`; `POST /me/onboarding/complete`.
   Moved here from (c) because 2.12 and 2.14 on the frontend need exactly these,
   and the column ships with the migration anyway. Writes to sections are **not**
   in this document yet (a documented operation must be served).
3. **(b) Section writes.** Education/experience/certifications
   create/patch/delete/order, `PUT /me/skills`, the shared lock/reorder helpers,
   the concurrency tests.
4. **(c) `DELETE /me`** (only if 3.6 is in).
5. `docs/m3-verification.md` in the last PR: fresh clone; verify, coverage ≥ 90 %,
   integration; second-user matrix; Q3 for owner/other/anonymous; private-field
   scan; barrier tests; a real Auth0 token editing every section over HTTP with
   stored rows checked; OpenAPI check; plan walk; guard proofs; CI; clean machine.

Reviews: both reviewers on every push; Copilot quota failures accepted (Codex
alone) per the tracker.

## 9. Frontend notes (not for this repo to change)

- 3.7: POST a section item only when valid; replace temporary ids with the
  response; `null`/`[]` instead of `undefined`; one `PATCH` per edited field.
- 3.8: generated types (§3); initials when `avatarUrl` is null; `website`, `bio`;
  six categories; profile project cards use `heroImageUrl`, not attachments.
- 2.12: id from `GET /v1/me`; ownership from `isOwner`.
- 2.14: show onboarding while `onboarded` is false; pre-fill from
  `GET /v1/me/profile`; "use my login email" → `PATCH contactEmail`; "Skip"
  also calls `onboarding/complete`; structured steps replace the free-text ones.
- 3.9: privacy toggle = `PATCH isPublic`; delete = `DELETE /v1/me`, then sign out.
- `next.config.ts` image hosts (§4.1).

## 10. Proposed tracker changes (for the orchestrator)

- Q3: record Levon's choice; Q5: decided as §3 (move from M4 to M3).
- 3.5: note "no frontend reorder UI today".
- 2.9: generated types land in M3 (3.8), not M4.
- 2.14/2.12: API side lands in PR (a).
- New follow-ups: anonymous profile views share the frontend's egress-address rate
  budget; notifications in other users' inboxes that name a deleted user (M5);
  oasdiff breaking-change check (decide, later); `docker compose` plugin missing
  from this machine's `docker` CLI path, use `docker-compose` (process).
