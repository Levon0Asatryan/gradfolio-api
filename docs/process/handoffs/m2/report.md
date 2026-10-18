# M2 report: stop point 1 (plan PR open)

From worker gradfolio-repos-93 (worktree `gradfolio-api-m2`, branch `m2/plan`).
Written here because `gradfolio-repos-94` is not in ListAgents.

## Task

M2, auth and identity. The plan PR (`docs/m2-plan.md` + `docs/auth0-setup.md`).

## Status

plan merged (#15 → main `cd5ad56`, 2026-09-30 14:15Z, merged on Levon's instruction). Next: PR (a).

## Pull requests

#15 M2 plan: auth and identity (Q7, Q11) + Auth0 setup checklist:
https://github.com/Levon0Asatryan/gradfolio-api/pull/15.
CI: all 5 jobs pass on 0b7050b (format/lint/types/OpenAPI, unit, integration, migrations,
container stack). `mergeable: MERGEABLE`. Threads: 0/0.
Reviewers requested on 0b7050b. Copilot: FAILED (quota). Codex: not yet reviewed when
this was written. Docs-only, so the merge does not wait for them.

## Investigation

Run against jose 6.2.12, @nestjs/throttler 6.7.1 (Nest 12), Express 5.2.1, MySQL 8.4.11,
@auth0/nextjs-auth0 4.14.0 (the frontend's lock) and 4.30.0. Outputs are in plan §2.

- An unreachable JWKS surfaces as a raw `TypeError` (refused, DNS) or a generic `JOSEError`
  (500, bad JSON, redirect). Mapping by class alone would give 500 or 401. So errors are
  classified by origin: key-resolution failures → 503, `JOSEError` → 401.
- jose accepts a token **without `exp`** unless `requiredClaims` names it. Also, the
  claim-validation errors carry the full payload, so they are never logged.
- `iss` is compared exactly: the issuer is normalized to one trailing slash.
- Provisioning race (barrier, 5 runs each): ODKU + `FOR SHARE` in `inTransaction` gives
  one row and the same id every time. A plain re-read after an earlier snapshot returns
  NO ROW. Catch-1062 is equally correct; ODKU chosen.
- Throttler: the default key is per route per client. Named throttlers apply to every
  route unless skipped, and a named 429 sends `Retry-After-<name>`. Guard order =
  provider order.
- Express: `trust proxy=true` returns the client-written left-most XFF. A hop count
  returns the proxy's.
- nextjs-auth0 v4: the `/auth/access-token` route is on by default and returns the token
  to the browser. 4.14 has no refresh buffer. Server Components cannot persist a
  refreshed token.

## What changed

Docs only. Decisions:

- Q7: row created on the first authenticated request (race-safe upsert).
- Q11: server-side calls only, no CORS, SDK token route off.
- 2.4: a post-login Action adds namespaced claims; the API makes no `/userinfo` calls.
- 2.3: two tenants (production created in M9), no automatic linking. Both pending
  Levon.
- 2.7: throttler keyed by the verified `sub` when authenticated, by IP otherwise.
  `search`/`import`/`ai` budgets are opt-in.
- `TRUST_PROXY` becomes a hop count.
- `verified` follows `email_verified`.

## Revalidation

n/a (plan). Tables formatted with prettier, cross-references checked, verify passes.

## Re-review

Self-review of the plan fixed one test that could not fail ("throttle before
provisioning") before the push. No review rounds yet.

## Decisions made

All in plan §1. Deviations from the handoff's wording:

- The default rate-limit budget is per route per client, not one global counter
  (plan §8.3).
- The headline pre-fill is kept, but expected empty (see Defects/contradictions).

## Evidence

Plan §2 (probe outputs). No code yet.

## Not verified

- Auth0 claims marked "cited" (sub formats, aud array, Action claims on refresh) are
  confirmed only in Phase 3 with real tokens.
- Copilot review: quota failure.

## Defects found / contradictions (plan §8)

1. investigation §4.2 vs tracker (audience). Reconciled: the code passes
   `AUTH0_AUDIENCE`, which is unset in production.
2. **Q8/2.14/7.10 promise a LinkedIn headline. LinkedIn's OIDC sign-in returns none**
   (name, picture, email only).
3. `TRUST_PROXY=true` lets a client choose its IP.
4. IP-keyed limits conflict with Q11: all users arrive from Vercel's IPs.
5. The 2.5 test list is missing `nbf`, a missing `exp`, the issuer slash, the `aud`
   array and outage → 503.
6. The SDK's `/auth/access-token` route conflicts with Q11.
7. Next 16 renamed `middleware.ts` to `proxy.ts`.

## Changes needed in other repos

- gradfolio: plan §10 (frontend notes), which covers:
  - audience;
  - SDK upgrade;
  - `enableAccessTokenEndpoint: false`;
  - refresh in `proxy.ts`;
  - `GRADFOLIO_API_URL` (API on 3001 locally);
  - the error envelope;
  - the route policy;
  - `/v1/me` pre-fill;
  - preview base URLs.
- gradfolio-sql: none.

## Proposed tracker changes (plan §9)

- Q7 and Q11 → decided.
- Q8 text: no headline.
- 2.3: pending Levon.
- 2.4 → Action.
- 2.5: extended test list.
- 2.7: wording.
- New follow-ups:
  - anonymous rate limiting behind Vercel (M6);
  - the `TRUST_PROXY` hop count on the M9 host;
  - the frontend refresh buffer.

## Open questions for Levon

1. Approve the plan (#15).
2. Run `docs/auth0-setup.md`, then send back:
   - the issuer and the audience;
   - which connections have test tokens in `gradfolio-api-m2/.env` (names in §7).
     Tokens live 1 h, so fill them right before saying "ready".
3. §8 of the checklist: the production tenant in M9 (recommended), and no automatic
   account linking (recommended).
4. Copilot quota: wait, upgrade, or accept Codex alone for #16/#17.

## Machine state

My compose project `gradfolio-m2` is down with `-v` (container, volume, network removed).
The M1 worker's checkout and containers were not touched. The worktree
`gradfolio-api-m2` stays for Phase 2.

One incident, fixed at once: my first `git worktree add` used a relative path that
resolved inside the main checkout (`gradfolio-api/gradfolio-api-m2`). I removed it
within seconds with `git worktree remove`, deleted the branch and recreated the
worktree at the right place. The main checkout's branch and status were unchanged
(`m1/atomic-dml-steps`, clean).

## Update 2026-09-30 (review round, merge)

- Codex round 1 on 0b7050b: one P1 on the plan. The throttler's `ttl` is in
  milliseconds, so `ttl = RATE_LIMIT_WINDOW_S` would have made a 60 ms window. I
  checked the premise (throttler 6.7.1 `increment()`: `ttlMilliseconds = ttl`) and it
  was right. Fixed in bbda1a7: `seconds(RATE_LIMIT_WINDOW_S)`, plus a test that fails
  without it. The other units in the plan were confirmed by the probes. Thread
  answered and resolved.
- Confirmation round on bbda1a7: Codex 👍 (no findings). Copilot: quota failure again.
  CI 5/5 green, MERGEABLE.
- Merged with `gh pr merge 15 --merge --match-head-commit bbda1a7`, at Levon's explicit
  instruction in the worker chat.
- `m2/plan` is dead now; PR (a) branches from the new main.
- Proposed tracker change (Follow-ups, from this round): none. The fix is in the plan.

## Stop point 2 (2026-09-30): PR (a) built and verified locally; waiting for Auth0

Branch `m2/token-guard` (7 commits on main `cd5ad56`, head `1a5545b`), **not pushed**. The
handoff requires a real Auth0 token to go through the verifier before the first push.

What PR (a) does:

- Config: the Auth0 issuer (normalized to one slash) and audience, the JWKS timeout, the
  clock tolerance and the rate-limit budgets. `TRUST_PROXY` is now `false` or a hop count.
- The jose verifier: an outage is classified by where it happens and answers 503; a bad
  token answers 401 with our reason code.
- The global token guard with `@Public()`.
- The throttler: keyed by `sub`, opt-in named budgets, a standard `Retry-After`.
- Mapping and headers (`WWW-Authenticate`, `Retry-After`), redaction.
- compose, CI, README and CLAUDE.md.

Evidence:

- Fresh clone: `npm ci`, build, verify 409/409, coverage 98.67/96.64/99.13/99.24, int
  69/69.
- Guard proofs: 25 guards removed, each test failed (after strengthening two tests that
  first did not fail: `setHeaders:false` and the `TRUST_PROXY=true` message).
- Real run on an empty volume (`-p gradfolio-m2`, 3308/3002):
  - migrations applied;
  - health and docs public (a junk token is ignored on /healthz); unknown /v1 → 404;
  - 120 requests/min per route, then 429 `RATE_LIMITED` with `Retry-After: 60`;
  - a new spoofed XFF each time did not reset the budget;
  - boot refuses `TRUST_PROXY=true` and unset Auth0 variables; `migrate` runs without
    them.
- Machine clean: `gradfolio-m2` containers, volume and network removed.

Decisions made (not in the plan's wording):

- Config split: `loadDatabaseConfig()` for migrate/seed/dump, so the compose `migrate`
  service needs no Auth0 values.
- `LOG_DESTINATION` (null in the app) lets tests read the real pipeline's log. A trap:
  nestjs-pino's root logger is static, so a file uses one capture. Recorded in
  CLAUDE.md.
- compose passes `${AUTH0_*}` without `:?`, so `docker compose up -d mysql` still works
  when they are unset; the api then refuses to boot.
- The rejection matrix against the _running_ API needs a protected route, so it runs in
  PR (b) with `/v1/me`. PR (a)'s matrix runs through the real HTTP pipeline in tests
  (probe controller).

Needed from Levon to continue: run docs/auth0-setup.md, then put in
`gradfolio-api-m2/.env`:

- `AUTH0_ISSUER_BASE_URL` and `AUTH0_AUDIENCE`;
- `M2_TEST_TOKEN_<CONNECTION>` for each connection you can test.

Tokens live 1 h. Say "ready" and I will:

1. verify them against PR (a) and push it;
2. build PR (b) (`/v1/me`, provisioning);
3. run the full Phase 3 with fresh tokens (I'll ask again then if they have expired).

## Update 2026-10-03: PR (a) #17 open and reviewed; PR (b) built locally

**Tenant and frontend, done through the Auth0 and Vercel MCP tools** (2026-10-02):

- Auth0:
  - the API `https://api.gradfolio.app` created (RS256, 1 h, offline access);
  - the Gradfolio app: localhost URLs, implicit grant removed, non-rotating refresh
    tokens;
  - the claims Action created, deployed and bound to post-login (bound by Levon).
- The leftover apps deleted and the secret rotated (Levon).
- Vercel:
  - `AUTH0_CLIENT_SECRET` updated: it still held the October 2025 value, which
    broke the code exchange (`feacft Unauthorized`);
  - `AUTH0_AUDIENCE` added;
  - production redeployed.
- Production login is verified in Auth0's logs: successful code exchanges with
  `audience: https://api.gradfolio.app`.
- Frontend `fix(nav)` #19, merged by Levon:
  - the Login menu item was a Next `<Link>`, which fetched /auth/login client-side,
    so the redirect to Auth0 failed CORS;
  - /auth/* items now render as a plain `<a>`.
  - **It leaves frontend `main` 0.01% under its branch-coverage floor** (1.69 vs
    1.70). A fix is ready as a patch; decision pending.

**PR (a) #17** (https://github.com/Levon0Asatryan/gradfolio-api/pull/17), head
`4c76823`:

- CI 5/5 green, MERGEABLE.
- Codex round 1: one P2. Optional profile claims were not length-bounded, contrary
  to plan §3.3. Fixed in 4c76823: `CLAIM_LIMITS`, each bound proven by removal.
  Thread resolved.
- Codex round 2: no findings. Copilot: quota failure on both heads.
- A real Auth0 token (Google) went through the verifier and the HTTP pipeline:
  accepted with the right `sub`; other audience → 401 `claim:aud`; altered `sub` →
  401 `signature`; no token or email in the log.
- A test-harness defect was found while proving it: an intermittent 404 under load,
  which also happens on `main` in bootstrap's body-parser tests (1 of 32 stressed
  runs). Fixed in d87d1fe, with test apps bound to 127.0.0.1; 0 of 40 stressed
  runs after.

**PR (b)**, branch `m2/me` (not pushed: it would stack on #17):

- `users` provisioning, `CurrentUserGuard`, `GET /v1/me`, OpenAPI with
  `bearerAuth`, `http/me.http`, and a CI check that `/v1/me` answers 401.
- 429 unit tests; integration tests on MySQL 8.4 including the barrier races;
  coverage 98.37 / 95.89 / 99.2 / 99.3.
- 15 guard proofs, each test seen failing.
- Phase 3 on the real compose stack, with a local tenant reached through
  host.docker.internal (empty volume):
  - the 10-case rejection matrix: every case 401 with the fixed body and
    `WWW-Authenticate: Bearer`; the log has no JWT, no claim email, no jose text,
    and all 26 authorization headers redacted;
  - JWKS unreachable → 503 `AUTH_UNAVAILABLE`;
  - public routes 200 and `/v1/me` 401;
  - `/v1/me` created the row (auth0_id = sub, pre-filled) and returned the same id
    after;
  - two concurrent first requests behind a competing insert, committing or rolling
    back: both 200, one id, 1 row;
  - 120 requests then 429 with Retry-After: 60, and a spoofed XFF did not reset it.
- Not yet done: real Auth0 tokens through `/v1/me` on the stack (Google's expired;
  others wait on the connections), then `docs/m2-verification.md`.

**Decisions made:**

- Claim bounds sit above the column limits, so the pre-fill can still cut.
- `buildApp` listens on 127.0.0.1.
- DB-only users code is excluded from unit coverage (covered by integration tests).
- Unit HTTP tests get a stub user resolver.

**Needed from Levon:**

1. Merge #17. The merge gate wants both reviewers; Copilot is quota-blocked, so
   decide.
2. Fresh real tokens in `gradfolio-api-m2/.env`: `M2_TEST_TOKEN_GOOGLE` now,
   others when the connections exist.
3. Frontend coverage fix: a small PR from me, or the frontend session.

**Proposed follow-ups:**

- (fe) The coverage floor on `main`.
- (api) The pre-existing supertest port flake on `main` is fixed by d87d1fe once
  it merges.

## Final (2026-10-03): PR (b) and the frontend coverage fix

- **#17 (a):** merged by Levon (`5314209`).
- **gradfolio-api #20 (b):** https://github.com/Levon0Asatryan/gradfolio-api/pull/20,
  head `35cf277`.
  - CI 5/5 pass. Codex: no findings. Copilot: quota failure.
  - Carries `docs/m2-verification.md`.
- **Real Auth0 token (Google) through `/v1/me` on the stack, empty volume:**
  - the first call created exactly one row (auth0_id = sub, pre-filled);
  - the second call returned the same id;
  - the concurrency barrier with the real sub, committing or rolling back, gave one
    row and one id;
  - an altered signature gave 401;
  - the log held no token or email.
- **gradfolio #20:** https://github.com/Levon0Asatryan/gradfolio/pull/20, head
  `232c7d6`.
  - The coverage fix for #19: branches 1.92% against the 1.70 floor.
  - CI and Vercel pass. Codex: no findings.
  - Receipt method `manual-review`: gradfolio-web-review is not loaded here.

**Not verified:** real tokens for database, GitHub and LinkedIn (connections not yet
configured); the Action on refresh-token exchange.

**Proposed tracker changes:** M2 api tasks 2.1–2.7 and 2.16 → done once #20 merges;
Q7 and Q11 decided; plus the §9 items of the plan.

**Cleanup after the merges:**

- remove the worktrees `gradfolio-api-m2` and `gradfolio-coverage`;
- leave the main checkouts alone.

## Closed (2026-10-03)

- gradfolio-api #20 (b) merged as `1116ba4`. M2's API side is complete: #15 plan, #17
  (a), #20 (b). Frontend: #19 and #20 merged.
- Cleanup done:
  - worktree `gradfolio-api-m2` removed, with its gitignored `.env` (expired test
    tokens) and its local settings;
  - local branches `m2/plan`, `m2/token-guard` and `m2/me` deleted;
  - no `gradfolio-m2` containers or volumes left;
  - the main checkouts and the M1 worker's state are untouched.
- Left for later: real-token checks for the database, GitHub and LinkedIn
  connections, once they are configured (auth0-setup §5). The frontend tasks
  2.9–2.15 go to the frontend session, from plan §10.

## Frontend done (2026-10-04)

- **gradfolio #21 merged** as `c94463d`: 2.9 API client (server-only), 2.10 route
  policy, 2.11 fail-closed `proxy.ts`, 2.13 login-aware navigation and `/account` on
  `GET /v1/me`, 2.15 docs and `.env.example`.
  - Codex round 1: 3 findings (collapsed logout label, http(s)-only avatars, trilingual
    503). All fixed in `29f6867` and `e9c6fa2`, threads resolved. Round 2: no findings.
    Copilot: quota failure.
  - Levon checked the logged-in flow locally.
- **2.12 and 2.14 moved to M3** (Levon's decision): they need the profile API.
- **gradfolio-api #23 open (docs only):**
  - tracker statuses and four new M2 follow-ups: `/` protected vs "public", preview
    login, `/projects/[id]` sync `params`, the `next dev` AGENTS.md block;
  - m2-verification §14 (frontend).
  - Both reviewers requested; docs-only PRs do not wait for them.
- **Cleanup:**
  - worktree `gradfolio-m2fe` removed, with its local `.env.local`;
  - branch `m2/frontend-auth` deleted locally;
  - no `next` processes left;
  - the main checkouts are untouched.
  - The worktree `gradfolio-api-m2docs` stays until #23 merges.
- **Still Levon's (auth0-setup §10):**
  - Client Credentials off;
  - per-app API access;
  - the origin lists;
  - a Universal Login check.

## M2 closed (2026-10-04)

- gradfolio-api #23 merged as `ea7046c`.
- Worktree `gradfolio-api-m2docs` and branch `docs/m2-frontend-done` removed.
- No M2 worktrees, containers or processes remain.
