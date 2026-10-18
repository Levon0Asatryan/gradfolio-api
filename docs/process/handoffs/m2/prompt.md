You are a worker chat on gradfolio-api, the backend API for Gradfolio: a student
portfolio platform (NPUA coursework) that serves the Next.js frontend from MySQL 8.4.
GitHub: Levon0Asatryan/gradfolio-api.

## Work in your own worktree, not the main checkout

**Another worker (M1) is working in the main checkout right now:**
`/Users/levon/Dev/university/gradfolio-repos/gradfolio-api`. Never switch that
checkout's branch or write in it: it would corrupt the M1 worker's state.

Create your own worktree and do everything there:

```sh
git -C /Users/levon/Dev/university/gradfolio-repos/gradfolio-api fetch origin
git -C /Users/levon/Dev/university/gradfolio-repos/gradfolio-api worktree add \
  /Users/levon/Dev/university/gradfolio-repos/gradfolio-api-m2 -b m2/plan origin/main
cd /Users/levon/Dev/university/gradfolio-repos/gradfolio-api-m2 && npm ci
```

Keep Docker away from the M1 worker's stack as well. The M1 worker may be using the
default project and ports, so always pass your own project name and ports:

```sh
export MYSQL_HOST_PORT=3308 API_HOST_PORT=3002
docker compose -p gradfolio-m2 up -d mysql
export TEST_DATABASE_URL=mysql://gradfolio:gradfolio@127.0.0.1:3308/gradfolio_test
```

Before running anything, check the ports are free:

```sh
lsof -nP -iTCP:3308 -iTCP:3002 -sTCP:LISTEN
```

When you finish, tear down only your own project: `docker compose -p gradfolio-m2 down -v`.

Read these first, in order:

1. CLAUDE.md
2. AGENTS.md
3. docs/tracker.md (M2, the Decisions table, and the Follow-ups row "M2 (Q7)")
4. docs/investigation.md §4.2 (the frontend's Auth0 setup)
5. docs/m1-plan.md and docs/m1-verification.md (the data layer you build on)

## Task

M2, auth and identity. This is the API side of tracker M2, plus the design the
frontend follows.

- A real login on the frontend must produce an access token that this API verifies,
  and that token must resolve to exactly one `users` row.
- The frontend implementation (tasks 2.8–2.15) is done later by a separate frontend
  session, in the `gradfolio` repo, from your plan. Your plan must be complete enough
  for that session to follow.

## Facts already established

These come from the live check on 2026-09-28 (tracker M2). Do not re-argue them.

- The frontend uses `@auth0/nextjs-auth0` v4 against a `dev-…` Auth0 tenant.
- The production login redirect sends **no `audience`**, so no API-scoped access
  token is issued today.
- Pages answer 200 while logged out: the middleware does not enforce login. That is
  correct for public portfolio links.
- No frontend code reads the session.
- LinkedIn (Q8, decided): sign-in only (name, headline, photo, email). Profile data
  arrives through the data-export import in M7, not here.

## Scope

In:

1. **Decide Q7 and Q11 in the plan.**
   - Q7 is how a `users` row is created. Starting point from M1: an
     `INSERT … ON DUPLICATE KEY UPDATE` on `auth0_id`, then a `FOR SHARE` re-read,
     inside `inTransaction`.
   - Q11 is how the frontend calls the API. Proposal: from the Next.js server only,
     with the access token kept server-side and no CORS.
2. **Auth0 configuration as a checklist Levon runs** (tasks 2.1–2.4). You cannot
   click the dashboard. Write `docs/auth0-setup.md` with exact steps:
   - the API (identifier = audience, RS256, access-token lifetime) and the Next.js
     application's access to it;
   - connections: database with email verification, Google, GitHub, LinkedIn;
   - callback and logout URLs for localhost, Vercel production and previews;
   - whether an Action adds `email_verified`/`email` to the access token (2.4), or the
     API calls `/userinfo`. Decide which, with the reason;
   - the separate-production-tenant question (2.3), with a recommendation;
   - how to obtain a **test user access token** for the real run in Phase 3.
3. **Token verification (2.5).**
   - Use `jose` with a remote JWKS: cached, refreshed on an unknown `kid`, and with a
     timeout on the fetch.
   - Fixed issuer and audience, expiry and not-before checks (small clock tolerance),
     **RS256 only**.
   - The config gains `AUTH0_ISSUER_BASE_URL` and `AUTH0_AUDIENCE`, validated at boot.
   - The guard applies to every `/v1` route by default. Public routes opt out with an
     explicit decorator, and the health routes stay public.
   - Error mapping: missing or invalid token → 401 `UNAUTHENTICATED`, with a stable
     body and no library message in the response or the log.
   - JWKS unreachable → 503. Do not return 401 for an outage.
4. **`@CurrentUser` and first-login provisioning (2.6).**
   - Race-safe: two concurrent first requests for the same `sub` produce one row.
     Force it with a **barrier**, never a sleep.
   - Pre-fill name, email and picture from the token or userinfo, and the headline
     when the identity is LinkedIn.
   - Ids generated in the app (M1 rule).
5. **`GET /v1/me`.** Returns the caller's own account (id, name, email, avatar,
   verified, isPublic, linked identities if available). It is documented in
   `openapi.yaml` through `OPERATIONS`, and its request is added to `http/me.http`.
6. **Rate limiting (2.7)** with `@nestjs/throttler`:
   - a global default, plus named budgets reserved for search, import and AI;
   - trust-proxy behaviour follows `TRUST_PROXY`, so a client cannot choose its own
     IP.
7. **Verified flag v1 (2.16):** `users.verified` from Auth0 `email_verified`. The
   GitHub part comes in M7.

Out:

- The `gradfolio` frontend repository. That is a separate session.
- Profile editing (M3).
- GitHub or LinkedIn API access (M7).
- Account deletion (M3, if kept).

## Known constraints and decisions already made

- Stack: NestJS 12, Node 24, TypeScript 6.0 (ESM), zod, pino, Kysely over mysql2
  (M1), Vitest. TypeScript stays on 6.0.x.
- `npm run dev` uses `nest start` (tsc), because tsx drops decorator metadata.
- M1's rules apply:
  - ids generated in the app;
  - every write goes through the Kysely layer;
  - `inTransaction` retries 1213;
  - validators count lengths the way MySQL does.
- The error envelope is `{code, message}`. Nothing internal reaches a response.
- The `src/core` → `src/api` dependency rule is enforced by
  `src/architecture.test.ts`.
- Redaction already covers `req.headers.authorization`. Add any token-bearing field
  you introduce.

## Deliverables

1. The plan PR: `docs/m2-plan.md` plus `docs/auth0-setup.md`. **Stop and report after
   it opens.**
2. **Stop point for Levon:** he runs `docs/auth0-setup.md` and gives you the
   issuer, the audience and a way to get a test user token. You cannot finish
   Phase 3 without a real Auth0 token.
3. After approval, 2 implementation PRs. Suggested split:
   - (a) the token guard, config, error mapping and throttler;
   - (b) provisioning, `@CurrentUser`, `GET /v1/me`, the verified flag, OpenAPI and
     `http/`.
4. `docs/m2-verification.md`, the final test record.

## Phase 1: Investigation (before any plan or code)

Answer each of these with evidence. Claims are **run** against the versions you pin,
not remembered.

1. **The token contract.**
   - Which claims does an Auth0 access token for a custom API carry by default (`sub`
     format per connection, `aud` as a string or an array, `scope`, `azp`)?
   - Where do the email and `email_verified` come from?
   - Cite Auth0's documentation for each.
2. **Verification pitfalls.** Algorithm confusion (`alg: none`, HS256 with the
   public key as secret), a missing audience check, `aud` given as an array, JWKS
   caching and key rotation, clock skew, issuer URL with or without a trailing slash.
   Each one becomes a test.
3. **`jose`'s remote JWKS behaviour.** Run it against a local JWKS server:
   - caching;
   - what happens on an unknown `kid`;
   - timeouts;
   - what it throws when the JWKS is unreachable (it must map to 503).
4. **The Next.js side (for the frontend session).**
   - How `@auth0/nextjs-auth0` v4 requests an audience.
   - `auth0.getAccessToken()` in server components, route handlers and server
     actions.
   - Refresh tokens (`offline_access`).
   - Verify against the v4 docs and the package source for the version the frontend
     pins.
5. **Race-safe provisioning on MySQL 8.4.**
   - Run the proposed ODKU + `FOR SHARE` re-read with two concurrent connections
     forced through a barrier. Show exactly one row, and that both callers get the
     same id.
   - Compare this with catching error 1062 and re-reading. Pick one.
6. **Throttler.** How `@nestjs/throttler` keys requests behind a proxy, what storage
   it uses (in-memory is fine at our scale; say why), and how named budgets are
   declared.
7. **Comparable systems and known bugs.** Published issues in `jose`,
   `@nestjs/throttler` and `@auth0/nextjs-auth0` v4 that touch this design.

List any contradictions between the tracker, the investigation and what you measured.

## Phase 2: Implementation

Follow the approved plan. Put any deviations in the report under "Decisions made".

- Every guard ships with a test that fails when the guard is removed. That includes
  the issuer, the audience, the algorithm, expiry, the public-route opt-out, the
  provisioning race and the throttler.
- A mapping from external signals is **untested until real examples have flowed
  through it**. Every error class `jose` throws, and a real Auth0 token, must pass
  through the real code.

## Phase 3: Revalidation, the final test

Record everything in `docs/m2-verification.md`: each command, its output, and PASS
or FAIL.

1. **Fresh clone** from your worktree:

   ```sh
   git clone <worktree> <dir> && git -C <dir> checkout <branch>
   ```

   then `npm ci`, `npm run build`, `npm run verify`, `npm run test:coverage` (floor
   90%) and `npm run test:int`. Use your own ports and project.

2. **Token rejection matrix**, against the running API, each with its status and
   body:
   - no token;
   - a malformed token;
   - `alg: none`;
   - HS256 signed with the public key;
   - wrong issuer;
   - wrong audience;
   - expired;
   - `nbf` in the future;
   - unknown `kid`;
   - a valid signature from a different key.
     Every one must answer 401 `UNAUTHENTICATED` with the stable body, and no library
     text may appear in the response or the log.
3. **JWKS outage:** with the JWKS URL unreachable, a request with a valid-looking
   token answers 503, not 401.
4. **Real Auth0 token** (after Levon's setup):
   - `GET /v1/me` with a real user access token creates the user on the first call;
   - a second call returns the same id;
   - the row shows `auth0_id` = `sub` and the pre-filled fields;
   - repeat for each connection that is enabled (database, Google, GitHub, LinkedIn,
     as far as test accounts allow), and record which were tested.
5. **Concurrency:** two concurrent first requests for a new `sub` against the real
   stack give one row and the same id for both. Use a barrier, and show the row
   count.
6. **Public routes:** `/healthz`, `/readyz`, `/docs` and `/docs-json` answer without a
   token, and every other `/v1` route answers 401 without one.
7. **Throttling:** exceeding the default budget answers 429 `RATE_LIMITED` with
   `Retry-After`, and a spoofed `X-Forwarded-For` does not reset it while
   `TRUST_PROXY=false`.
8. **Real run:**
   - on an empty volume, `docker compose -p gradfolio-m2 up -d --build`, with
     migrations applied;
   - exercise `/v1/me` over HTTP with a real token and check the stored row;
   - tear down with `docker compose -p gradfolio-m2 down -v`.
9. **OpenAPI:** `/v1/me` is documented, `npm run openapi:check` passes, and
   `document.test.ts` still matches the served routes both ways.
10. **Plan walk:** point every "must" in `docs/m2-plan.md` at its implementing line,
    and list any gap.
11. **Guard proofs:** a table with columns | guard removed | test that failed |.
12. **CI:** every job is green on the head commit of each PR.
13. **Machine clean:** only your own project's containers and volumes are removed.
    The M1 worker's are left alone. Remove your worktree after your last PR merges.

## Phase 4: Re-review

- Phase 3 finishes before the first push of code.
- Run /gradfolio-review. If the skill is not loaded in your session, run its passes
  by hand and write the receipt with an honest `method`.
- **Both reviewers on every push:** `sh scripts/request-review.sh <pr>`.
- The head counts as reviewed only when `sh scripts/review-status.sh <pr>` exits 0.
  Copilot's review quota is exhausted, so it will report "Copilot: FAILED" until
  Levon decides. Record that under "Not verified".
- Two rounds, then fix-now findings only. The last fix push gets one confirmation
  round on the head commit.
- One push per round. Every fix push re-runs the full gate and a check of what the
  fix could have broken. Resolve each thread once its fix is verified.

## Stop points

- After opening the plan PR (`docs/m2-plan.md` + `docs/auth0-setup.md`): stop and
  report.
- After approval, when you need Levon's Auth0 setup and test credentials: stop and
  report. **Never put secrets in the repo, in a PR or in a log.** Take them from a
  local `.env` that Levon fills in.
- Do not merge. Do not push to main. Do not edit docs/tracker.md; propose changes in
  your report.
- Do not touch the main checkout, or the M1 worker's containers.

## When to report, and when not to

Send one report per pull request, when it is finished: pushed, CI green, both
reviewers' rounds done, threads resolved, machine clean. Also report at the stop
points above.

Report mid-flight only in these cases:

1. You are blocked, you have diagnosed the cause, and clearing it needs a decision
   that is not yours.
2. Something invalidates the plan's design.
3. You find a defect in work that is already merged.
4. You need something outside your worktree.

Send reports to the orchestrator session **gradfolio-repos-94** with SendMessage, in
the format from docs/handoff-template.md, part 2. If that session is not listed in
ListAgents, write the report to
`/Users/levon/Dev/university/gradfolio-repos/m2-report.md`.

Include a "Frontend notes" section listing exactly what the frontend session needs
from your plan:

- the audience and scope;
- how to get the token (v4 API);
- the base URL environment variable;
- the error envelope;
- the route policy;
- the pre-fill fields.
