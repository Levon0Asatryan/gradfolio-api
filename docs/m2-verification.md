# M2 verification

The final test record for M2 on the API side: tracker 2.1–2.7 and 2.16,
[m2-plan.md](m2-plan.md). Run on 2026-10-02 and 2026-10-03 against MySQL 8.4.11 and
the Auth0 tenant `dev-wkthnyn8b8mjn5ae`.

- Every stack run starts from an **empty volume** (`docker-compose -p gradfolio-m2
down -v`), on this worktree's own project and ports (MySQL 3308, api 3002), away
  from the M1 worker's stack.
- Local runs use the standalone `docker-compose` binary; CI uses `docker compose`.
- No token, secret or email appears in this record. Real tokens lived only in the
  gitignored `.env`.

Pull requests:

- #15: plan, merged.
- #17: (a) guard, config, errors, rate limits; merged as `5314209`.
- PR (b): provisioning and `/v1/me`, the PR carrying this record.
- Frontend #19 (`gradfolio`): login links.

| #   | Check                                  | Result                        |
| --- | -------------------------------------- | ----------------------------- |
| 1   | Fresh clone: build and full gate       | PASS                          |
| 2   | Token rejection matrix (running api)   | PASS                          |
| 3   | JWKS outage → 503                      | PASS                          |
| 4   | Real Auth0 token, per connection       | PASS (Google); others not run |
| 5   | Concurrency: two first requests        | PASS                          |
| 6   | Public routes, protected by default    | PASS                          |
| 7   | Throttling and spoofed X-Forwarded-For | PASS                          |
| 8   | Real run on an empty volume            | PASS                          |
| 9   | OpenAPI                                | PASS                          |
| 10  | Plan walk                              | PASS, deviations listed       |
| 11  | Guard proofs                           | PASS                          |
| 12  | CI on each PR's head                   | see §12                       |
| 13  | Machine clean                          | PASS                          |

## 1. Fresh clone

```sh
git clone /Users/levon/Dev/university/gradfolio-repos/gradfolio-api-m2 <dir>
git -C <dir> checkout m2/me      # PR (b) head, rebased on main 5314209
npm ci && npm run build && npm run verify && npm run test:coverage && npm run test:int
```

| Command                 | Printed                                                                           | Result |
| ----------------------- | --------------------------------------------------------------------------------- | ------ |
| `npm ci`                | added 437 packages, found 0 vulnerabilities                                       | PASS   |
| `npm run build`         | `dist/api/me/me.controller.js` present                                            | PASS   |
| `npm run verify`        | Prettier clean, lint, types, `openapi.yaml: up to date`, 30 files, **457 passed** | PASS   |
| `npm run test:coverage` | statements 98.37%, branches 95.89%, functions 99.2%, lines 99.3% (floor 90%)      | PASS   |
| `npm run test:int`      | 16 files, **86 passed**                                                           | PASS   |

PR (a) at its head (`d87d1fe`, then `4c76823` after review) passed the same gate
in a fresh clone:

- unit 409, then 415 after review;
- coverage 98.67% statements, 96.65% branches;
- integration 69.

## 2. Token rejection matrix

The compose api was pointed at a local tenant that the container reaches as
`host.docker.internal` (`AUTH0_ISSUER_BASE_URL=http://host.docker.internal:<port>/`).
Tokens were signed by that tenant's key or forged against it.

```
GET /v1/me
no token                               401 {"code":"UNAUTHENTICATED","message":"authentication required"} WWW-Authenticate: Bearer
malformed                              401 (same body)  WWW-Authenticate: Bearer
alg none                               401 (same body)  WWW-Authenticate: Bearer
HS256 signed with the public key       401 (same body)  WWW-Authenticate: Bearer
wrong issuer                           401 (same body)  WWW-Authenticate: Bearer
wrong audience                         401 (same body)  WWW-Authenticate: Bearer
expired                                401 (same body)  WWW-Authenticate: Bearer
nbf in the future                      401 (same body)  WWW-Authenticate: Bearer
unknown kid                            401 (same body)  WWW-Authenticate: Bearer
valid signature from a different key   401 (same body)  WWW-Authenticate: Bearer
rejection causes logged: missing | malformed | alg | alg | claim:iss | claim:aud |
  expired | claim:nbf | unknown-key | signature
```

The api log (`docker-compose logs api`, 211 lines) held:

- no JWT segment (`eyJ`: 0);
- no matrix token and no claim email;
- no jose text (`claim validation failed`, `signature verification failed`, `"alg"
(Algorithm)`: none);
- 26 `authorization` headers, all `[redacted]`.

The script's first check reported `contains token: true`. That was a false
positive: the slice it searched for in the 9-character `not.a.jwt` was empty.
Re-checked by `grep` as above.

**PASS**

## 3. JWKS outage

The local tenant was stopped and the api restarted, so its key cache was cold:

```
valid-looking token, JWKS unreachable -> 503 {"code":"AUTH_UNAVAILABLE","message":"authentication is temporarily unavailable"}
cause logged: token signing keys unavailable: TypeError
```

Every other outage class went through the real verifier against a real HTTP JWKS in
the unit suite (`access-token.test.ts`): timeout (`JWKSTimeout`), 500, malformed
JSON, malformed key set (`JWKSInvalid`), redirect, refused connection and DNS
failure. All give 503, none 401.

**PASS**

## 4. Real Auth0 token

The configured issuer is `https://dev-wkthnyn8b8mjn5ae.us.auth0.com/`, and the
audience `https://api.gradfolio.app`. Google login was done through the local
frontend's `/auth/access-token`. The token header is `RS256`, `typ JWT`, with a
`kid` from the tenant's JWKS. `aud` is `[api, …/userinfo]`, and the Action's
claims are present.

Through the verifier and the HTTP pipeline (2026-10-02, PR (a)):

| Case                                       | Result                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| real token                                 | accepted: `sub` google-oauth2, `email_verified` true, `identities` [google-oauth2], no headline |
| same token, api configured for another aud | 401 `claim:aud`                                                                                 |
| real header and signature, `sub` altered   | 401 `signature`                                                                                 |
| over HTTP / with the signature altered     | 200 with the right `sub` / 401, fixed body, `WWW-Authenticate: Bearer`                          |
| log                                        | no token, no email; cause `access token rejected: signature`                                    |

On the running stack, empty volume (2026-10-03, PR (b)):

```
rows before: 0
first  -> 200 {"id":"ebe4c8b4-…","name":"Levon Asatryan","email":"<email>","avatarUrl":"https://lh3.googleusercontent.com/…","headline":"","verified":true,"isPublic":true,"identities":["google-oauth2"]}
second -> 200 same id: true
rows after: 1
row: id ebe4c8b4-…, auth0_id google-oauth2|1132…, name Levon Asatryan, email <email>, avatar_url https://lh3…, headline '', verified 1, is_public 1
auth0_id = token sub: true; email = token email: true
real token, signature altered -> 401 {"code":"UNAUTHENTICATED","message":"authentication required"}
log: real token false; email false; JWT segments 0
```

| Connection                | Tested                                                                     |
| ------------------------- | -------------------------------------------------------------------------- |
| Google (`google-oauth2`)  | **yes**                                                                    |
| Database (email/password) | no: no test token yet                                                      |
| GitHub                    | no: the connection is not configured yet                                   |
| LinkedIn                  | no: the connection is not configured yet (no headline expected, plan §8.2) |

**PASS for Google.** The other connections are recorded under "Not verified".

## 5. Concurrency

A third connection inserts the same `auth0_id` in an open transaction. Two `GET
/v1/me` run, and the script polls `performance_schema.data_lock_waits` until both
are queued (a barrier, no sleep). Then the holder commits or rolls back.

```
local tenant:  holder COMMIT   waiters 3: 200/200, same id: true, rows 1
               holder ROLLBACK waiters 3: 200/200, same id: true, rows 1
real token:    holder COMMIT   waiters 3: 200/200, same id: true, rows 1
               holder ROLLBACK waiters 3: 200/200, same id: true, rows 1
```

The rollback case is where InnoDB deadlocks one waiter (1213). `inTransaction`
retries it: with the retry removed, the test fails (§11).

**PASS**

## 6. Public routes

```
/healthz 200   /readyz 200   /docs-json 200   /docs 200   (no token)
/v1/me (no token) -> 401 UNAUTHENTICATED
```

`/v1/me` is the only `/v1` route; an unknown path is 404 with or without a token.
A junk token on `/healthz` is ignored: 200, checked in the CI stack job too.

**PASS**

## 7. Throttling

Default budget 120 per 60 s per route per caller. 125 requests to `/healthz`, each
with a new spoofed `X-Forwarded-For`, then one more (`TRUST_PROXY=false`):

```
status counts: {"200":119,"429":6}   (one /healthz earlier in the run: 120 allowed)
then 429 Retry-After: 60 {"code":"RATE_LIMITED","message":"too many requests"}
```

The spoofed header did not reset the budget. Per-user keying, named budgets,
`TRUST_PROXY=1` and the seconds-not-milliseconds window are in
`rate-limit.test.ts` (§11). At boot, `TRUST_PROXY=true` is refused:
`TRUST_PROXY: must be "false" or a hop count such as "1"; "true" trusts a
client-written header`.

**PASS**

## 8. Real run

```
$ docker-compose -p gradfolio-m2 down -v && … up -d --build
 Container gradfolio-m2-mysql-1 Healthy · migrate-1 Exited · api-1 Started
ready after 1s
migrations: applied 0001_baseline (11 steps) · 0002_value_checks (5) · 0003_project_terms (16) · 0004_project_source (1)
```

Then §2–§7 over HTTP, and §4 with the real token. Stored rows were checked in
MySQL (§4, §5). At the end: `docker-compose -p gradfolio-m2 down -v`.

The boot refusals and the migrate service (PR (a) run):

- Auth0 settings unset → the api refuses to boot, naming
  `AUTH0_ISSUER_BASE_URL` and `AUTH0_AUDIENCE`;
- `migrate` without them → `migrations: nothing to apply`;
- `stop api` → exit 0.

**PASS**

## 9. OpenAPI

- `npm run openapi:check` → `openapi.yaml: up to date`.
- `getMe` is under `/v1/me` with `security: [bearerAuth]`, the `meResponseSchema`
  200, and 401/429/503.
- `document.test.ts` passes: served routes = documented routes, both ways.
- Renaming the documented path fails it (§11).

**PASS**

## 10. Plan walk

| Plan                                                                                                              | Implemented at                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| §1 Q7: row created on the first authenticated request; plain read first, then upsert                              | `users.service.ts:31`, `:40`                                                            |
| §1/§2.5 ODKU `id = id`, then `FOR SHARE`, in `inTransaction`                                                      | `user.repository.ts:43`, `:49`; `users.service.ts:40`                                   |
| §3.4 ids generated in the app                                                                                     | `user.repository.ts:35` (`newId()`)                                                     |
| §1 Q11 server-side calls, no CORS on the api                                                                      | no CORS middleware (`bootstrap.ts` unchanged); frontend notes §10                       |
| §2.2/§3.3 RS256 only, fixed issuer and audience, `exp`+`sub` required, clock tolerance                            | `access-token.ts:182`–`:188`                                                            |
| §2.2 outage classified at key resolution → 503                                                                    | `access-token.ts:167`, `:177`; `errors.ts:36`                                           |
| §3.2 JWKS URL derived from the issuer, no discovery fetch                                                         | `access-token.ts:162`                                                                   |
| §3.2 issuer normalized to one slash, https in production                                                          | `schema.ts:109`, `:170`                                                                 |
| §3.2 `TRUST_PROXY` false or a hop count; `true` refused                                                           | `schema.ts:81` (and its rules above)                                                    |
| §3.2 JWKS timeout, clock tolerance, rate-limit settings validated at boot                                         | `schema.ts:113`–`:124`                                                                  |
| §3.3 one 401 body, reason code for the log only, `WWW-Authenticate: Bearer`                                       | `errors.ts:24`; `access-token.ts:130` (`rejectionReason`)                               |
| §3.3 claims parsed with zod, bounded, dropped when malformed                                                      | `access-token.ts:71` (`CLAIM_LIMITS`), review #17                                       |
| §3.1 guard order: token → rate limit → user                                                                       | `api.module.ts:40`, `:41`, `:44`                                                        |
| §3.1 protected by default; `@Public()` opt-out; health public                                                     | `access-token.guard.ts:25`; `health.controller.ts:11`                                   |
| §3.6 key = verified `sub`, else address                                                                           | `rate-limit.guard.ts:23`                                                                |
| §3.6 `ttl = seconds(…)`; named budgets opt-in; `setHeaders: false`                                                | `rate-limit.module.ts:29`, `:40`, `:33`                                                 |
| §3.6 standard `Retry-After` and 429 `RATE_LIMITED`                                                                | `rate-limit.guard.ts` (`throwThrottlingException`); `app-error.ts` (`RateLimitedError`) |
| §3.7 redact `*.email`, `*.claims`; nothing from jose logged                                                       | `redaction.ts:27`; `http-mapping.ts` (`logDetail`)                                      |
| §3.4 pre-fill: name cut to 255 code points, email checked, picture http(s), headline LinkedIn only, fallback name | `prefill.ts:64`, `:51`, `:59`, `:16`                                                    |
| §3.4 existing rows never overwritten except `verified`                                                            | `user.repository.ts:43` (`id = id`), `:62`; `users.service.ts:44`                       |
| §3.4 warn when the token has no profile claims (no values)                                                        | `users.service.ts:37`                                                                   |
| §3.5 `/v1/me` response, no `auth0_id`/phone/birthday; identities fallback                                         | `me.dto.ts:4`; `me.controller.ts:12`                                                    |
| §3.5 OpenAPI `getMe` with `bearerAuth`; `http/me.http`                                                            | `document.ts:84`, `:160`; `http/me.http`                                                |
| §3.2 `.env.example`, compose, CI stack env                                                                        | `.env.example`; `docker-compose.yml:55`; `ci.yml:206`                                   |

**Deviations** (the plan's wording versus the code; none changes the design):

- **Config split.** `loadDatabaseConfig()` for migrate, seed and dump, so the compose
  `migrate` service needs no Auth0 settings.
- **Claim bounds** sit above the column limits (`CLAIM_LIMITS`). A 300-character name
  passes the verifier, and the pre-fill cuts it to 255, as §3.4 says.
- **Test infrastructure.**
  - `LOG_DESTINATION` lets tests read the real pipeline's log, with one capture per
    file, because nestjs-pino's root logger is static.
  - `ProbeController` (tests only) covered protected and budgeted routes before
    `/v1/me` existed.
  - Unit HTTP tests get `stubUsers` when the database is stubbed.
- **`buildApp` listens on 127.0.0.1** (d87d1fe). Under load, supertest's wildcard
  bind let a request reach another test server (an intermittent 404, also on `main`).
  Stressed: 0 of 40 runs after, against 3 of 32 before.
- **Coverage.** The users repository and service are excluded from unit coverage, as
  M1's database code is. They are covered against MySQL 8.4 by
  `user.repository.int.test.ts` and `me.int.test.ts`.

Gaps: none found.

## 11. Guard proofs

Each guard was removed on the final code and the named test was run; every one
failed. Integration mutations ran against MySQL 8.4 (3308).

| Guard removed                                                               | Test that failed                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `algorithms: ['RS256']`                                                     | refuses alg none / HS256 signed with the public key / RS512                     |
| issuer check                                                                | refuses another issuer; an issuer without the trailing slash                    |
| audience check                                                              | refuses another audience, and an ID token                                       |
| `requiredClaims: ['exp','sub']`                                             | refuses a token with no expiry                                                  |
| clock tolerance from config                                                 | refuses an expired / not-yet-valid token within the tolerance only              |
| key-resolution wrapper (outage → 503)                                       | answers 503, not 401, when the JWKS times out / answers 500 / malformed JSON    |
| `JWKSNoMatchingKey` passthrough                                             | refuses a key id the tenant does not publish; not refetched during the cooldown |
| `sub` ≤ 255                                                                 | refuses a subject longer than `users.auth0_id`                                  |
| claim string bounds (review #17)                                            | drops an email / name / picture claim over its bound                            |
| identities count and entry bounds                                           | drops an identities claim with too many entries, or an entry too long           |
| bearer scheme parse                                                         | finds no token in `Basic …`                                                     |
| `@Public()` on health                                                       | serves health outside the version prefix; health and docs public                |
| `AccessTokenGuard` registered                                               | lets a valid token through / refuses a request with no token                    |
| guard order (token before the limit)                                        | is per user, so users behind one address do not share it                        |
| `RateLimitGuard` registered                                                 | 429 with Retry-After; per user; spoofed X-Forwarded-For                         |
| tracker = verified `sub`                                                    | is per user                                                                     |
| `throwThrottlingException` override                                         | answers 429 RATE_LIMITED with a standard Retry-After                            |
| `seconds()` window                                                          | counts a window in seconds, not milliseconds                                    |
| named-budget `skipIf`                                                       | apply only to routes that opted in                                              |
| `setHeaders: false`                                                         | no per-budget headers                                                           |
| `TRUST_PROXY=true` refusal                                                  | refuses TRUST_PROXY=true                                                        |
| issuer normalization / https in production                                  | normalizes the issuer; requires an https issuer in production                   |
| filter sets required headers                                                | WWW-Authenticate on 401                                                         |
| `logDetail` instead of `describeError`                                      | logs only a reason, no jose text                                                |
| redact `*.email`                                                            | never writes a nested email                                                     |
| `Retry-After` ≥ 1 s                                                         | rounds Retry-After up, never below one second                                   |
| `ON DUPLICATE KEY` (plain INSERT)                                           | two concurrent first requests (commit, rollback); never overwrites              |
| `FOR SHARE` re-read (plain SELECT)                                          | returns a competitor's committed row even to a transaction that read before it  |
| `inTransaction` retry (one attempt)                                         | yield one row and one id when a competing insert rolls back                     |
| ODKU updating the name on a duplicate                                       | never overwrites an existing row                                                |
| `verified` sync                                                             | makes verified follow email_verified, both ways                                 |
| `setVerified` scoped to the id                                              | syncs verified both ways, and only changes the row it names                     |
| user guard after the rate limit                                             | checks the rate limit before it touches the database                            |
| user guard skips public routes                                              | health resolves no caller; bootstrap health tests                               |
| pre-fill: name cut / picture http(s) / email check / LinkedIn-only headline | the matching `prefill.test.ts` cases                                            |
| response built field by field (row spread → `auth0Id` leaks)                | returns the caller … mapped to the response shape                               |
| identities fallback from `sub`                                              | names the login provider from the subject                                       |
| `/v1/me` in `OPERATIONS`                                                    | documents exactly the routes Nest serves                                        |

Two tests did not fail when first tried. Each was strengthened and proven:

- `setHeaders: false`: it now also checks the 200 responses.
- The `TRUST_PROXY=true` message: it now asserts the specific reason.

One test could not fail as written, and was removed before the first push: "an
invalid token cannot spend a public route's budget". Budgets are per route, so it
held either way. The per-user test proves the guard order instead.

## 12. CI

| PR                    | Head                 | Jobs                                                                                         |
| --------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| #15 (plan)            | `0b7050b`, `bbda1a7` | 5/5 pass; Codex: 1 finding (ttl units, fixed), then 👍; merged                               |
| #17 (a)               | `d87d1fe`, `4c76823` | 5/5 pass on both; Codex: 1 finding (claim bounds, fixed), then no findings; merged `5314209` |
| (b), this record's PR | see the PR           | recorded in the PR                                                                           |
| gradfolio #19         | `12ea2f0`            | build, lint, Vercel pass; coverage 1.69% < 1.70% floor (fix: gradfolio #20)                  |

Copilot failed on quota on every head (tracker, 2026-09-29).

## 13. Machine clean

| Started                                                                                  | Removed                                                  |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `gradfolio-m2-mysql-1`, `-migrate-1`, `-api-1`, volume `gradfolio-m2_mysqldata`, network | yes (`docker-compose -p gradfolio-m2 down -v`, each run) |
| probe database `m2_probe` (investigation)                                                | gone with the volume                                     |
| the local test tenants (JWKS servers) and scratch clones                                 | stopped / in the session scratchpad only                 |
| the M1 worker's containers and checkout                                                  | not touched                                              |

The worktree `gradfolio-api-m2` is removed after the last PR merges.

## Not verified

- **Real tokens for the database, GitHub and LinkedIn connections.** They wait on the
  connections (auth0-setup §5) and test accounts.
- **The verified flag from a real unverified database account.** Covered with
  local-tenant tokens only.
- **The Auth0 Action on refresh-token exchange:** not observed with a real refreshed
  token.
- **Copilot reviews:** quota exhausted.
