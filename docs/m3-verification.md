# M3 verification

The final test record for M3 on the API side: tracker 3.1–3.6, the API half of 2.12 and
2.14, [m3-plan.md](m3-plan.md). Unit, integration, clone, stack and guard runs on
2026-10-05 against MySQL 8.4.11 on `origin/main` at `b0aa64d` (after #28), with the
follow-up #29 (§11.1). Every stack run starts from an **empty volume**
(`docker-compose -p gradfolio-m3 down -v`), on this worktree's own project and ports
(MySQL 3309, api 3003). Local runs use the standalone `docker-compose`; this
machine's `docker` CLI has no `compose` plugin.

No token, secret or email appears in this record. Local-tenant tokens were signed by the
test JWKS server; the real-token run (§7) used Levon's Google login.

Pull requests:

| PR      | What                                         | Head → merge          | Reviews                                                                          |
| ------- | -------------------------------------------- | --------------------- | -------------------------------------------------------------------------------- |
| #25     | plan                                         | `04f171b` → `e17a46b` | Codex round 1: 1 finding (0-row onboarding UPDATE → 404), fixed in the plan      |
| #26     | (a) contract, reads, header, onboarding      | `5712abf` → `03f3c2a` | Codex: no findings                                                               |
| #27     | (b) section writes, skills, reorder          | `ed292d0` → `d299f00` | Codex: 1 finding (rate-limit test could pass for the wrong reason); fixed in #28 |
| #28     | (c) `DELETE /v1/me`                          | `66c4736` → `b0aa64d` | Codex on `66c4736`: 1 finding (lock order), fixed in #29                         |
| #29     | follow-up: deletion takes the user row first | see the PR            | requested                                                                        |
| this PR | verification (docs only)                     |                       | requested; merge does not wait                                                   |

Copilot failed on quota on #25–#28 (tracker, 2026-09-29), so those pushes were reviewed by
Codex alone; on #29 Copilot reviewed the head (no comments).

| #   | Check                                          | Result                    |
| --- | ---------------------------------------------- | ------------------------- |
| 1   | Fresh clone: build and full gate               | PASS                      |
| 2   | Second-user matrix over every write            | PASS                      |
| 3   | Q3: owner / other user / anonymous             | PASS                      |
| 4   | No private field in any public response (grep) | PASS                      |
| 5   | Concurrency under barriers                     | PASS                      |
| 6   | OpenAPI                                        | PASS                      |
| 7   | Real Auth0 token, every section over HTTP      | RESULT_7                  |
| 8   | Plan walk                                      | PASS, deviations listed   |
| 9   | Guard proofs (39 removals, final code)         | PASS, 3 redundant (§11.2) |
| 10  | CI on each PR's head                           | PASS (5/5 jobs on each)   |
| 11  | Machine clean                                  | PASS                      |

## 1. Fresh clone

```sh
git clone <checkout> <dir> && git -C <dir> checkout m3/verification   # = main b0aa64d
npm ci && npm run build && npm run verify && npm run test:coverage && npm run test:int
DATABASE_URL=… npm run db:types:check && npm run migrate
```

| Command                     | Printed                                                                                                          | Result |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| `npm ci`                    | 437 packages; `npm audit --omit=dev`: 0 vulnerabilities (dev tooling: `braces`, high, in a dev dependency chain) | PASS   |
| `npm run build`             | six profile controllers in `dist/api/profiles/`                                                                  | PASS   |
| `npm run verify`            | Prettier clean, lint, types, `openapi.yaml: up to date`, 32 files, **523 passed**                                | PASS   |
| `npm run test:coverage`     | statements 97.78%, branches 95.76%, functions 96.77%, lines 98.83% (floor 90%)                                   | PASS   |
| `npm run test:int`          | 21 files, **193 passed**                                                                                         | PASS   |
| `db:types:check`, `migrate` | types up to date; `nothing to apply`                                                                             | PASS   |

Re-run on `main` at `7488c1d` (after #29–#36): verify **535 passed**, integration **195
passed**, coverage 97.8 / 95.8 / 96.85 / 98.85, `openapi.yaml: up to date`.

Migration 0005 up, down, up: `db:schema` before and after the cycle is byte-identical.

Coverage: the DB-bound files of M3 are excluded from unit coverage (`vitest.config.mts`)
with the reason beside them, as M1's database code is: the profile repositories and
services, the visibility predicate, the controllers, and `me/services`. They are covered
against MySQL 8.4 by `profiles.int.test.ts`, `sections.int.test.ts`,
`account.int.test.ts` and the repositories' `*.int.test.ts`.

## 2. Second-user matrix

Running stack (api in compose, local tenant, empty volume), two users, alice with one
entry set per section; bob acts on alice's ids. Script output:

```
PASS  second user: PATCH, DELETE, PUT order on alice's education -> 404/404/404
PASS    education: a foreign id answers exactly like an unknown id
PASS  second user: PATCH, DELETE, PUT order on alice's experience -> 404/404/404
PASS    experience: a foreign id answers exactly like an unknown id
PASS  second user: PATCH, DELETE, PUT order on alice's certifications -> 404/404/404
PASS    certifications: a foreign id answers exactly like an unknown id
PASS  alice's whole profile unchanged after all of bob's writes (header, skills, onboarding, 9 foreign-id writes)
PASS  bob's skills are bob's only  Rust
PASS  stored: alice's education rows intact  {"c":2,"d":"BSc"}
```

The writes that take no id (`PATCH /v1/me/profile`, `PUT /v1/me/skills`,
`POST /v1/me/onboarding/complete`, `DELETE /v1/me`) act on the caller's row by
construction; bob's calls left alice's profile byte-identical, and the integration suite
checks the same per endpoint (`profiles.int.test.ts`, `sections.int.test.ts`,
`account.int.test.ts`: "a second user …", "only changes the caller's list", "deletes only
the caller's account"). Each repository statement is also scoped on its own and tested
without the service's earlier check (`ordered-section.repository.int.test.ts`).

## 3. Q3 (option A, decided by Levon)

```
PASS  Q3 public : anonymous 200, other user 200, owner 200 (isOwner true)
PASS  Q3 private: anonymous 404, other user 404, owner 200 (isOwner true)
PASS  Q3 private profile body == unknown id body (no existence oracle)
PASS  public profile + invalid token -> 401 (not anonymous)
```

The policy is one predicate, `visibleTo` (`visibility.ts:15`), applied in the SQL.

## 4. No private field in any response

The matrix filled the private columns directly (phone, birthday, a GitHub integration with
access token, refresh token and external id), then read every endpoint as anonymous,
other user and owner, and scanned each body, key and value:

```
PASS  grep: forbidden keys (auth0Id, auth0_id, phone, birthday, accessToken, refreshToken, access_token, refresh_token, externalUserId, external_user_id) in 53 responses  0 hits
PASS  grep: private values (phone, birthday, integration tokens, external id, auth0 sub, bearer token) in the same responses  0 hits
PASS  grep: the login email appears only in GET /v1/me  0 elsewhere
PASS  grep: api log holds no token, phone, birthday, sub or email  0 hits over 196 lines
```

Also in the suite: the profile column list is explicit (`profile.repository.ts:14`; a test
fails if `phone` is added), and `document.test.ts` scans every schema in `openapi.yaml`
for the forbidden names and allows the login `email` only on `GET /v1/me`.

## 5. Concurrency (barriers, no sleeps)

Each test holds a lock on a second connection and uses `waitForLockWaiters` (the server's
`data_lock_waits`), then releases it.

| Race                                              | Test                                                                           | Result                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| two creates at cap − 1                            | `sections.int.test.ts` "two creates at cap - 1: one 201, one 409"              | one 201, one 409                                  |
| reorder racing a create                           | "a reorder racing a create sees the new entry and answers 409"                 | 409 `ORDER_STALE`, nothing written                |
| two skill replacements                            | "two skill replacements queue on the user lock …"                              | both 200; the list equals exactly one caller's    |
| create / reorder / skills racing account deletion | "… answer 404, not a foreign-key 500"                                          | 404 ×3, no orphan                                 |
| two patches of one entry                          | "two patches of one entry cannot each break the rule"                          | one 200, one 400; the stored entry keeps the rule |
| over-cap skills                                   | "rolls back whole when over the cap"                                           | old list and registry untouched                   |
| deletion behind a write in flight                 | `account.int.test.ts` "waits for a write in flight, then deletes that row too" | 204, no orphan                                    |
| deletion vs. a user-then-child writer             | "takes the user row before the team rows" (#29)                                | no deadlock                                       |
| header / onboarding after a concurrent deletion   | `profiles.int.test.ts`                                                         | 404, not 200                                      |

## 6. OpenAPI

`npm run openapi:check` → `openapi.yaml: up to date`. 21 operations; `document.test.ts`
compares them with Nest's route table both ways, resolves every `$ref`, requires path
parameters to match the `{names}` in the path, and refuses two different schemas under
one component name. `openapi-typescript` 7.13.0 generates types from the file (checked on
the PR (b) head): bodies, path parameters and nullable fields come out as expected.

## 7. Real Auth0 token

REAL_TOKEN

## 8. Plan walk

| Plan                                                                                     | Implemented at                                                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| §1 Q3: one predicate, in SQL                                                             | `visibility.ts:15`; used in `profile.repository.ts` (`findVisibleUser`)                                                    |
| §1 write lock on the user row, one lock order                                            | `core/db/user-lock.ts` (`lockUser`); `section.service.ts` create, reorder; `skills.service.ts`; `account.service.ts` (#29) |
| §1 matched-row counts; "0 rows → 404"                                                    | `profile.service.ts:68`; `onboarding.service.ts`; `section.service.ts` update, delete; `account.service.ts`                |
| §1 `users.contact_email`, public; `users.email` private                                  | migration `0005`; `PROFILE_COLUMNS` omits `email`                                                                          |
| §1 onboarding column, `onboarded` on `/v1/me`, `POST …/complete`                         | `0005`; `me.controller.ts:31`, `:37`                                                                                       |
| §1 new rows first (`MIN − 1`); reorder rewrites 0..n−1                                   | `ordered-section.repository.ts` (`topSortOrder`, `applyOrder`)                                                             |
| §1 plain text; no HTML                                                                   | no sanitizer path exists; bio rendered as text by contract                                                                 |
| §1 limits in config                                                                      | `schema.ts:137`–`:140`                                                                                                     |
| §3 Q5: bodies, params, component schemas in the contract                                 | `document.ts` (`convert`, `pathParameters`)                                                                                |
| §5.1 `@OptionalAuth`: absent header anonymous, a sent one verified                       | `access-token.guard.ts:38`; `current-user.guard.ts:38`                                                                     |
| §5.2 migration with a down                                                               | `0005_profile_fields.{up,down}.sql`                                                                                        |
| §5.3 header PATCH strict, `links` merge, `null` clears                                   | `profile.dto.ts` (`updateProfileSchema`); `profile.repository.ts` (`updateHeader`)                                         |
| §5.3 create: lock → count → top → insert                                                 | `section.service.ts:38`–`:45`                                                                                              |
| §5.3 patch: locked read, merge, validate whole, 0 → 404                                  | `section.service.ts:66`                                                                                                    |
| §5.3 reorder: lock, foreign id 404, stale 409, one `CASE` update                         | `section.service.ts:93`, `:97`                                                                                             |
| §5.3 skills: lock, `setUserSkills`, cap inside the transaction                           | `skills.service.ts:28`–`:29`                                                                                               |
| §5.3 experience skills through the registry                                              | `experience.repository.ts:50`                                                                                              |
| §5.3 delete account: started log, scrub avatars, delete, completed log                   | `account.service.ts`                                                                                                       |
| §5.4 projects: own + accepted-team; public only for others; owner sees own private/draft | `project-summary.repository.ts`                                                                                            |
| §5.4 `isOwner`                                                                           | `profile.service.ts:31`                                                                                                    |
| §6 each proof                                                                            | §2–§5, §9                                                                                                                  |
| §9 frontend notes                                                                        | listed in the PR descriptions; FE work is gradfolio's                                                                      |

**Deviations** (none changes the design):

- **PR (a) moved onboarding** from (c) to (a), as the plan §8 says.
- **Section files.** The generic flow lives in `section.service.ts` with one
  `SectionDefinition` per section, rather than one service per section.
- **`lockUser` is in `core/db`**, not `profiles/utils` (moved in #29, because `me` uses it).
- **(c) shipped without the user-row lock** (#28), against the plan's §5.3. I had judged
  it provable only as "no outcome changes" and removed it. Codex found the deadlock it
  prevents; a run confirmed it (the new test fails 5/5 without the lock), and #29 restored
  it per the plan. The lesson recorded: "no test fails" meant the test was missing, not
  that the lock was redundant.
- **`GET /v1/me/profile` response** carries `id` as well as the editable fields.

Gaps: none found.

## 9. Guard proofs

Each guard below was removed on the final code (`main` at `b0aa64d`, plus #29 for the
last lock) and the integration (or unit) tests that cover it were run. "Failed" is the
number of failing tests; the last column is the first.

| PR  | Guard removed                          | Failed | First failing test                                                                         |
| --- | -------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| a   | visibleTo always true                  | 4      | answers an anonymous caller with 404, the same body as an unknown id                       |
| a   | profile column list gains phone        | 1      | selects only the profile columns -- no login email, phone, birthday or auth0 id            |
| a   | toHeader spreads the row               | 1      | returns the caller’s header, created on first use with the pre-filled fields               |
| a   | PATCH /me/profile schema non-strict    | 10     | rejects the unknown key verified instead of ignoring or writing it                         |
| a   | updateHeader 0 rows not 404            | 0      | (none: redundant behind another guard, §11.2)                                              |
| a   | onboarding 0 rows not 404              | 1      | answers 404 when the account is deleted after the request was authenticated                |
| a   | optional auth: any header = anonymous  | 4      | shows the owner their own private profile, with isOwner                                    |
| a   | user guard no optional skip            | 36     | serves a public profile to an anonymous caller, with every section                         |
| a   | projects: no public filter for others  | 1      | lists own and accepted-team projects; others see public published ones only                |
| a   | projects: pending counts as member     | 1      | lists own and accepted-team projects; others see public published ones only                |
| a   | projects: member sees private          | 1      | lists own and accepted-team projects; others see public published ones only                |
| a   | projects: no limit                     | 1      | merges own and team projects newest first and applies the limit to the merged list         |
| a   | isOwner always false                   | 2      | shows the owner their own private profile, with isOwner                                    |
| b   | create: no user lock                   | 2      | two creates at cap - 1: one 201, one 409                                                   |
| b   | create: no cap                         | 4      | stops at the per-user cap with 409 LIMIT_REACHED                                           |
| b   | update: no row lock                    | 1      | two patches of one entry cannot each break the rule the other kept                         |
| b   | update: no merged validation           | 3      | validates a patch against the stored entry as a whole                                      |
| b   | delete: ignore 0 rows                  | 9      | deletes an entry; a second delete is 404                                                   |
| b   | delete: not scoped                     | 3      | gets 404 on patch, delete and reorder of the first user’s entries, and changes nothing     |
| b   | education update: not scoped           | 1      | update matches no row for another user’s entry, and changes nothing                        |
| b   | education lockOne: not scoped          | 2      | lockOne and getOne see only the caller’s entries                                           |
| b   | reorder: no user lock                  | 5      | a reorder racing a create sees the new entry and answers 409 instead of dropping it        |
| b   | reorder: no stale check                | 4      | refuses a repeated id and an incomplete list (409 ORDER_STALE), leaving the order alone    |
| b   | reorder: foreign id not 404            | 3      | gets 404 on patch, delete and reorder of the first user’s entries, and changes nothing     |
| b   | applyOrder: not scoped                 | 1      | applyOrder writes only the caller’s rows and reports how many matched                      |
| b   | topSortOrder always 0                  | 4      | a new entry goes one below the smallest sort_order, or at 0 in an empty section            |
| b   | skills: no user lock                   | 1      | a create and a reorder racing the account’s deletion answer 404, not a foreign-key 500     |
| b   | skills: no cap check                   | 1      | rolls back whole when over the cap: the old list and the registry are untouched            |
| b   | lockUser: no not-found                 | 1      | a create and a reorder racing the account’s deletion answer 404, not a foreign-key 500     |
| b   | experience skills not canonicalized    | 1      | go through the terms registry: one spelling per name, shared with the skills list          |
| b   | patch education schema non-strict      | 1      | a patch is a strict subset, and may not be empty                                           |
| b   | create certification schema non-strict | 1      | refuses a missing required field and unknown keys on create                                |
| b   | rate limit key shared across routes    | 2      | give every new route its own per-caller budget                                             |
| c   | no avatar scrub                        | 1      | leaves the name and role on other people’s projects, without the photo or the account link |
| c   | scrub not scoped                       | 1      | leaves the name and role on other people’s projects, without the photo or the account link |
| c   | delete not scoped                      | 3      | removes the account and everything under it, and nothing of anyone else’s                  |
| c   | delete 0 rows not 404                  | 1      | records the start even when the deletion then finds nothing: 404, no "completed"           |
| c   | no started log                         | 2      | writes the started line before the change and the completed line after, with the id only   |
| -   | docs routes: rename documented path    | 1      | documents exactly the routes Nest serves -- nothing missing, nothing extra                 |

Plus, from #29: removing `lockUser` from the deletion fails "takes the user row before the
team rows" in 5 of 5 runs.

## 10. CI

All five jobs (format/lint/types/OpenAPI, unit + coverage, integration on MySQL 8.4,
migrations on MySQL 8.4, container stack) passed on #25–#28 at their merged heads and
`gh pr view` said MERGEABLE. #29 and this PR: see the PRs.

## 11. Defects found by running, and caveats

### 11.1 Defects

1. **Account deletion lock order** (Codex, #28; fixed in #29): see §8.
2. **A rate-limit test that could not fail** (Codex, #27; fixed in #28): the first two
   calls' statuses were discarded, so a budget shared across routes still passed. Now it
   asserts calls 1 and 2 are not 429 and 3 is; with the key made shared across routes it
   fails.
3. **Test isolation:** the `terms` registry is global and survives `DELETE FROM users`;
   two section tests saw each other's terms until each test cleared it.
4. **A guard-removal run that proved nothing** (own run): my first proof of "create schema
   strict" ran only the unit suite, which does not cover that schema; re-run against the
   integration suite it fails as it should.
5. **Missing guard coverage found by removal:** the service's 0-row checks were backed by
   a second guard, and three statement-level ownership scopes (update, reorder, avatar
   scrub) were not covered by any test until repository-level tests and a second member's
   photo were added.
6. **Coverage fell under the floor** (88.8%) when the profile code first landed; the
   DB-bound files were excluded with reasons, as M1's are, and the suite measures 97.8%.

### 11.2 Guards that no single test fails for

- `ProfileService.updateHeader`'s "0 rows → 404" and `SectionService.update`'s "0 rows →
  404" are unreachable behind the guard before them (`getHeader`'s not-found; the locked
  read). Removing either alone fails nothing; removing `updateHeader`'s check _and_
  `getHeader`'s fails "answers 404, not 200, when the account is deleted …". The
  statement-level scoping beneath them is tested directly. They stay as defence.
- `applyOrder`'s matched-count check after the reorder cannot fail under the lock; it
  exists so a bug rolls back instead of half-applying.

### 11.3 The review receipt

`.review/.last-review.json` is written by the `gradfolio-review` skill's instructions,
which are a checklist for the author: it ran no external reviewer. Each receipt (0 open
findings) means the author walked passes 0–3 over the diff and ran pass 0 for real
(verify, coverage, integration, fresh clone). The independent review was Codex on every
push; Copilot was unavailable (quota).

### 11.4 Proposed tracker changes

- M3: 3.1–3.6 API side done (#26–#28, #29); 2.12 and 2.14 API side done (`isOwner`,
  `onboarded`, `POST /v1/me/onboarding/complete`, `contactEmail`).
- Q3 decided: option A. Q5 decided: `openapi-typescript` in the frontend at a pinned API
  commit (m3-plan §3); 2.9's generated types land with 3.8 (M3).
- **2.10:** `/` stays protected. The public pages are `/profile/[id]`, `/projects/[id]`
  and `/search` (anonymous recruiters, spec §8d), not "all personal pages".
- 3.5: there is no frontend reorder UI today; the endpoints exist for the task and for M4.
- New follow-ups:
  - anonymous profile views share the frontend server's address for rate limiting (120/min
    per route by default);
  - notifications in other users' inboxes that name a deleted user (M5);
  - an oasdiff breaking-change check on `openapi.yaml` (decide, later);
  - the frontend `next.config.ts` image hosts must allow the providers' avatar hosts, and
    must not open `remotePatterns` to every host;
  - this machine's `docker` CLI lacks the `compose` plugin: use `docker-compose -p …`.

## 12. Machine clean

| Started                                                                                  | Removed                                       |
| ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| `gradfolio-m3-mysql-1`, `-migrate-1`, `-api-1`, volume `gradfolio-m3_mysqldata`, network | TEARDOWN                                      |
| local test tenants (JWKS servers), scratch clones, probe scripts                         | stopped / deleted from the session scratchpad |
| worktree `gradfolio-api-m3` and its branches                                             | WORKTREE                                      |

## Not verified

- **Real tokens for the database, GitHub and LinkedIn connections** (only Google), as in
  M2. The second-user matrix uses local-tenant tokens: a real second account was not used.
- **A real browser edit** of every section through the frontend: the frontend is not wired
  to these endpoints yet (3.7).
- **Copilot reviews:** quota exhausted.
- **Behaviour on Aiven's MySQL** (TLS, the free tier's limits): MySQL 8.4.11 in Docker only.
