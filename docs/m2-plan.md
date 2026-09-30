# M2 plan: auth and identity

Tracker tasks 2.1–2.16, API side, plus the design the frontend follows (2.8–2.15 are
done later by a frontend session, from §11). Decides **Q7** (when the user row is
created) and **Q11** (how the frontend calls the API). The Auth0 dashboard steps are in
[auth0-setup.md](auth0-setup.md).

Every claim marked **run** was executed on 2026-09-30 with the versions this repo pins
or would pin: jose **6.2.12**, @nestjs/throttler **6.7.1** on @nestjs/common/core 12.1,
Express 5.2.1, mysql2 3.24.4, MySQL **8.4.11** (compose project `gradfolio-m2`),
Node 24.20; for the frontend, @auth0/nextjs-auth0 **4.14.0** (the `gradfolio` lockfile)
and 4.30.0 (latest). Probe scripts ran outside the repo; the outputs that matter are
quoted. Claims marked **cited** come from vendor documentation (linked) and are
confirmed with a real token in Phase 3.

## 1. Decisions

| ID       | Decision                                                                                                                                                                                                                                                                                                                       | Evidence       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| Q7       | The row is created on the **first authenticated request to any protected route** (in practice `GET /v1/me`). Fast path: a plain `SELECT` by `auth0_id` outside any transaction. Miss: `inTransaction` { `INSERT … ON DUPLICATE KEY UPDATE id = id`, then `SELECT … FOR SHARE` }. Chosen over catch-1062 + re-read.             | §2.5           |
| Q11      | The frontend calls the API **only from the Next.js server** (Server Components, Route Handlers, Server Actions) with `Authorization: Bearer <access token>` from `auth0.getAccessToken()`. The token never reaches browser JavaScript: the SDK's `/auth/access-token` route is turned off. **No CORS** on the API.             | §2.4, §3.1     |
| 2.4      | A **post-login Action** puts namespaced profile claims into the access token (`email`, `email_verified`, `name`, `picture`, `identities`, and `headline` if Auth0 has one). The API does **not** call `/userinfo`.                                                                                                             | §2.1           |
| 2.3 (a)  | **Two tenants, created when needed:** the current `dev-…` tenant stays for localhost and previews through M8; a separate production tenant is created in M9 (9.4). Nothing in the API changes: issuer and audience are config.                                                                                                 | auth0-setup §8 |
| 2.3 (b)  | **No automatic account linking in v1.** A person who signs in with Google and later with GitHub has two Auth0 users, so two `sub`s and two rows. Linking by email is an account-takeover path when one side's email is unverified. Proposed for Levon; the alternative (Auth0's user-prompted linking) is M3+ at the earliest. | auth0-setup §8 |
| 2.5      | `jose` `jwtVerify` with `createRemoteJWKSet(issuer + '.well-known/jwks.json')`, `algorithms: ['RS256']`, fixed `issuer` and `audience`, `requiredClaims: ['exp', 'sub']`, `clockTolerance` from config (5 s). Errors are classified **by where they happened**, not only by class: failures while resolving the key are 503.   | §2.2, §3.3     |
| 2.7      | `@nestjs/throttler`, in-memory. Every route has the `default` budget; `search`, `import` and `ai` are named budgets that apply **only** to routes that opt in. Authenticated requests are keyed by the verified `sub`, others by client IP.                                                                                    | §2.6, §3.6     |
| 2.7      | `TRUST_PROXY` becomes **`false` or a hop count** (`1`, `2`, …). `true` is refused at boot: Express then believes the left-most `X-Forwarded-For` entry, which the client writes.                                                                                                                                               | §2.6           |
| 2.16     | `users.verified` = the token's `email_verified`, written at creation and re-synced on any request where they differ. M7 widens the formula (… OR linked GitHub) in the same function.                                                                                                                                          | §3.4           |
| Pre-fill | Name, email, avatar at creation from the claims; headline only for a `linkedin\|` subject and only if the claim is present (expected absent, §8.2). Existing rows are never overwritten except `verified`.                                                                                                                     | §3.4           |

## 2. Investigation

### 2.1 The token contract (cited)

| Claim / fact                           | Value for our API                                                                                                                                                                                                 | Source                                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iss`                                  | `https://<tenant-domain>/`, **with** the trailing slash                                                                                                                                                           | [Access token profiles](https://auth0.com/docs/secure/tokens/access-tokens/access-token-profiles)                                                                                                                                         |
| `sub`                                  | `<provider>\|<id>`: `auth0\|…` (database), `google-oauth2\|…`, `github\|…`, `linkedin\|…`                                                                                                                         | [User profile structure](https://auth0.com/docs/manage-users/user-accounts/user-profiles/user-profile-structure)                                                                                                                          |
| `aud`                                  | the API identifier as a string, or an **array** `[<identifier>, https://<tenant>/userinfo]` when `openid` is in the scope. The frontend's default scope includes `openid` (§2.4), so real tokens carry the array. | access token profiles                                                                                                                                                                                                                     |
| `azp`, `scope`, `iat`, `exp`, `gty`    | Auth0 profile (default): `azp` = client id, header `typ: JWT`. RFC 9068 profile: `client_id`, `jti`, `typ: at+jwt`. Neither is checked by us.                                                                     | access token profiles                                                                                                                                                                                                                     |
| email, `email_verified`, name, picture | **Not** in an access token by default. They come from `/userinfo` or from claims an Action adds. Custom claims on an access token for a custom API **must be namespaced** (`https://…/email`).                    | [Custom claims](https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims), [post-login event](https://auth0.com/docs/customize/actions/explore-triggers/signup-and-login-triggers/login-trigger/post-login-event-object) |
| `/userinfo`                            | rate-limited per user (Auth0 does not publish one stable figure; community reports 5–10/min)                                                                                                                      | [Rate limit policy](https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy)                                                                                                                          |
| JWKS                                   | `https://<tenant-domain>/.well-known/jwks.json`, RS256 keys with `kid`                                                                                                                                            | Auth0 JWKS docs                                                                                                                                                                                                                           |
| API settings                           | identifier immutable; signing algorithm set at creation (RS256 or HS256) and immutable; max access-token lifetime default 86,400 s; "Allow Offline Access" required for refresh tokens with that audience         | [API settings](https://auth0.com/docs/get-started/apis/api-settings)                                                                                                                                                                      |
| API access policy                      | new APIs default to "All apps allowed" for user-delegated access; "Per-app authorization" requires a grant per application                                                                                        | [API access policies](https://auth0.com/docs/get-started/apis/api-access-policies-for-applications)                                                                                                                                       |
| LinkedIn                               | Sign In with LinkedIn using OpenID Connect gives `sub`, `name`, `given_name`, `family_name`, `picture`, `locale`, `email`, `email_verified`. **No headline.**                                                     | [LinkedIn OIDC](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2) (updated 2024-08)                                                                                                   |

**Action vs `/userinfo` (2.4).** Action, because:

- `verified` must track `email_verified` on every token, not only on the first request.
  `/userinfo` per request would hit its per-user rate limit and make every request
  depend on a second Auth0 endpoint.
- Tokens stay self-contained, so every test and the Phase 3 rejection matrix run
  against locally signed tokens exactly as against real ones.
- Cost: a claim can be up to one token lifetime stale (1 h, auth0-setup §2); the
  Action is dashboard config, versioned in `auth0-setup.md`.

### 2.2 `jose` remote JWKS (run)

Local JWKS server (`node:http`), `createRemoteJWKSet(url, { timeoutDuration })`:

```
30 verifies (10 concurrent on a cold cache): fetches=1
new kid k2 within cooldown                   REJECT JWKSNoMatchingKey   fetches=1 coolingDown=true
new kid k2 after cooldown (rotated in)       OK                         fetches=2
random kid #0..#4 (flood, within cooldown)   REJECT JWKSNoMatchingKey   fetches still 2
jwks hang                                    REJECT JWKSTimeout ERR_JWKS_TIMEOUT (502ms at timeout 500)
jwks 500                                     REJECT JOSEError ERR_JOSE_GENERIC
jwks badjson                                 REJECT JOSEError ERR_JOSE_GENERIC
jwks badjwks                                 REJECT JWKSInvalid ERR_JWKS_INVALID
jwks redirect (302)                          REJECT JOSEError ERR_JOSE_GENERIC   (fetch uses redirect: 'manual')
jwks port closed                             REJECT TypeError "fetch failed" (not a JOSEError)
jwks DNS failure                             REJECT TypeError "fetch failed", cause ENOTFOUND
JWKS publishes a private key                 REJECT JWKSInvalid
after cacheMaxAge, JWKS 500                  REJECT JOSEError        (stale keys are not used)
JWKS back                                    OK
```

What follows for the design:

- **Caching:** one fetch serves concurrent and later verifies; concurrent reloads are
  coalesced. Defaults kept: `cacheMaxAge` 10 min, `cooldownDuration` 30 s (source,
  `jwks/remote.js`).
- **Unknown `kid`:** refetch at most once per cooldown, so a flood of random `kid`s costs
  one fetch per 30 s; a rotated-in key is picked up after the cooldown.
- **Timeout:** `AbortSignal.timeout(timeoutDuration)`, default 5 s; ours from config
  (`AUTH0_JWKS_TIMEOUT_MS`, default 3000).
- **Outage signals are heterogeneous.** A refused connection or DNS failure is a raw
  `TypeError`, not a `JOSEError`; a 500 is the generic `JOSEError`. A mapping by class
  would send a refused connection to 500 and could send a generic `JOSEError` to 401. So
  the verifier wraps the key resolver: any error while resolving the key, **except**
  `JWKSNoMatchingKey` and `JWKSMultipleMatchingKeys` (the token names a key we do not
  have), becomes `KeySourceUnavailable` → **503**. Everything else jose throws is a
  `JOSEError` → **401**. Anything else → 500 (a bug, logged). Run with that wrapper: port
  closed → 503, JWKSInvalid → 503, unknown kid → 401.
- **After `cacheMaxAge`, an outage fails every request** (no stale-while-error in jose
  6). At our scale an Auth0 outage is a login outage anyway; accepted, noted in §8.3.
- **Duplicate `kid`s** in a JWKS give `JWKSMultipleMatchingKeys` (jose 6's `jwtVerify`
  does not try each key); Auth0 never publishes duplicates. 401.
- A broken JWK (`n` = `!!`) fails later, in `checkModulusLength`, as a `TypeError`
  outside key resolution → 500. Only Auth0 could publish one; not mapped further.

### 2.3 Verification pitfalls (run), each a test

Options: `{ issuer, audience, algorithms: ['RS256'], clockTolerance: 5, requiredClaims: ['exp','sub'] }`.

| Case                                        | jose 6.2.12 result                                   | Without the option that stops it                                        |
| ------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| valid                                       | OK                                                   |                                                                         |
| malformed (`abc`, `a.b.c`, `''`, 5 parts)   | `JWSInvalid`                                         |                                                                         |
| `alg: none`                                 | `JOSEAlgNotAllowed`                                  |                                                                         |
| HS256 signed with the public key (PEM)      | `JOSEAlgNotAllowed` (checked **before** key lookup)  | `algorithms` omitted: `JOSENotSupported` (the JWKS refuses secret algs) |
| RS512                                       | `JOSEAlgNotAllowed`                                  |                                                                         |
| wrong issuer                                | `JWTClaimValidationFailed` claim=iss                 |                                                                         |
| issuer **without** the trailing slash       | `JWTClaimValidationFailed` claim=iss (exact compare) |                                                                         |
| wrong audience / ID token (aud = client id) | `JWTClaimValidationFailed` claim=aud                 | `audience` omitted: **accepted**                                        |
| `aud` array containing ours (+ userinfo)    | OK                                                   |                                                                         |
| `aud` array without ours; no `aud`          | claim=aud check_failed / missing                     |                                                                         |
| expired 60 s ago / 3 s ago                  | `JWTExpired` / OK (tolerance 5 s)                    |                                                                         |
| `nbf` 60 s ahead / 3 s ahead                | claim=nbf / OK                                       |                                                                         |
| **no `exp`**                                | claim=exp missing                                    | `requiredClaims` omitted: **accepted, never expires**                   |
| no `sub`                                    | claim=sub missing                                    |                                                                         |
| unknown `kid`                               | `JWKSNoMatchingKey`                                  |                                                                         |
| other key, same `kid`; tampered payload     | `JWSSignatureVerificationFailed`                     |                                                                         |
| unknown `crit` header                       | `JOSENotSupported`                                   |                                                                         |
| signed payload not a JSON object            | `JWTInvalid`                                         |                                                                         |
| `typ: at+jwt` (RFC 9068 profile)            | OK (not checked)                                     |                                                                         |

Two facts for logging: **`JWTClaimValidationFailed` and `JWTExpired` carry the whole
payload** on the error (`payload` property: email, name…), and jose messages quote
claim names. So nothing from a jose error is logged except a reason code we derive
(§3.7).

### 2.4 The Next.js side (source of 4.14.0, checked against 4.30.0)

- **Audience.** v4 does not read `AUTH0_AUDIENCE`/`AUTH0_SCOPE` by itself;
  `authorizationParameters.audience` must be passed. The frontend already passes
  `audience: process.env.AUTH0_AUDIENCE` (`src/lib/auth0.ts`); the variable is **unset in
  production**, so no audience is sent (§8.1).
- **Scope.** With `scope: undefined`, 4.14's `ensureDefaultScope` falls back to
  `openid profile email offline_access` (`utils/scope-helpers.js`), so a refresh token
  is requested once the API allows offline access.
- **`getAccessToken()`**: `auth0.getAccessToken()` in Server Components, Route Handlers
  and Server Actions; `getAccessToken(req, res)` in middleware/proxy. It refreshes
  **only when the token has already expired** in 4.14 (`expiresAt <= now`); 4.30 adds
  `tokenRefreshBuffer` (seconds before expiry). Our 5 s clock tolerance covers a token
  that expires in flight.
- **Server Components cannot persist a refreshed token** (the SDK's own warning,
  `server/client.js` `saveToSession`). The SDK's documented pattern: refresh in the
  proxy/middleware when the token is near expiry, with `getAccessToken(req, res, {
refresh: true })`.
- **Refresh token rotation:** the SDK docs recommend an overlap period, or rotation off
  for server-side apps (concurrent refreshes otherwise race). auth0-setup §3: off.
- **`/auth/access-token` is on by default** (`enableAccessTokenEndpoint ?? true`) and
  returns the access token as JSON to any browser holding the session cookie. Q11 keeps
  tokens server-side, so the frontend sets `enableAccessTokenEndpoint: false`. Levon
  uses it **locally, once**, to obtain the Phase 3 test token (auth0-setup §7).
- **Next.js 16 deprecates `middleware.ts` in favour of `proxy.ts`** (Node runtime by
  default; [docs](https://nextjs.org/docs/app/api-reference/file-conventions/proxy),
  v16.0.0). The frontend still has `middleware.ts`.
- **Preview deployments:** 4.14 takes one static `APP_BASE_URL`; 4.30 also accepts an
  allow-list. Each preview has its own host, so the base URL and Auth0's callback list
  must name the branch alias being tested (auth0-setup §4).

### 2.5 Race-safe provisioning on MySQL 8.4.11 (run)

A third connection (the "holder") inserts the same `auth0_id` in an open transaction;
the provisioning transaction(s) start and block on the key; the script polls
`performance_schema.data_lock_waits` until they are queued (barrier, no sleep); then
the holder commits or rolls back. Five runs each:

```
holder commits:
odku + FOR SHARE                                         holderId rows=1 (x5)
odku + plain re-read, no earlier read                    holderId rows=1 (x5)
odku + plain re-read, earlier read in trx (RR snapshot)  NO ROW   rows=1 (x5)   <- wrong
odku + FOR SHARE, earlier read in trx                    holderId rows=1 (x5)
plain insert, catch 1062, FOR SHARE re-read              holderId rows=1 (x5)
plain insert, catch 1062, plain re-read, earlier read    NO ROW   rows=1 (x5)   <- wrong
holder rolls back:
odku + FOR SHARE, one waiter                             ownId rows=1 (x5)
odku + FOR SHARE, two waiters                            one ownId, other ERR 1213; rows=1 (x5)
plain + 1062, two waiters                                one ownId, other ERR 1213; rows=1 (x5)
two first requests (A holds, B blocks, A commits)        same id rows=1 (x5)
```

- Exactly one row every time; every caller that completes gets the committed id.
- ODKU and catch-1062 are **equally correct**; both need the locking re-read once the
  transaction has an earlier snapshot, and both deadlock a waiter (1213) when a
  competitor rolls back, so both need `inTransaction`'s retry.
- **Chosen: ODKU.** The normal path raises no error, and the SQL is the one M1 already
  proved with Kysely (`canonicalizeTerms`). `ON DUPLICATE KEY UPDATE id = id` changes
  nothing on the existing row: a user's own edits are never overwritten by a login.
- `FOR SHARE` stays even though our own transaction has no earlier read: the
  provisioning function is correct in any transaction, and its guard test calls it in
  one that has read first (§4).

### 2.6 `@nestjs/throttler` 6.7.1 (source and run, on Nest 12)

- **Peer range** includes `^12.0.0` (6.5.0 did not: throttler#2669, closed).
- **Tracker:** `getTracker(req)` = `normalizeIp(req.ip)` (IPv6 masked to /64).
  **Key:** `sha256(<Class>-<handler>-<throttlerName>-<tracker>)`, so a budget is **per
  route, per client**.
- **Named throttlers:** every throttler given to `forRoot` applies to **every** route
  unless skipped. Opt-in per route works with `skipIf` reading route metadata (run).
- **Headers:** a named throttler's 429 carries `Retry-After-<name>`, not `Retry-After`
  (run: `retry-after-search=60`). We send the standard header ourselves (§3.6).
- **Guard order:** global guards run in the order their `APP_GUARD` providers are
  listed in one module (run: `auth>throttle`).
- **Storage:** in-memory `Map`s, an idle-record sweep on an `unref`'d interval, cleared
  on shutdown. One API process (Q9) and tens of users: in-memory is exact for one
  process and costs nothing. A second instance would need shared storage (Redis); out of
  scope.

Run, default budget 3, `search` budget 2 opted in on `/search` only:

```
trust proxy=false:
anon /me #1..#3 (X-Forwarded-For 10.0.0.1..3)   200, remaining 2,1,0
anon /me #4    (X-Forwarded-For 10.0.0.4)       429 retry-after=60          <- spoofing does not reset
alice /me #4                                     429;  bob /me #1  200      <- per user
carol /search #3                                 429 retry-after-search=60
carol /me after that                             200                        <- budgets are separate
bad token                                        401 [auth] (throttle never ran)
trust proxy=true:
anon /me #1..#4 with a new XFF each              200, remaining 2 every time <- spoofable
```

Express `req.ip` (run, 5.2.1):

```
trust proxy=false : "6.6.6.6, 203.0.113.9" -> 127.0.0.1
trust proxy=true  : "6.6.6.6, 203.0.113.9" -> 6.6.6.6       (client-written, left-most)
trust proxy=1     : "6.6.6.6, 203.0.113.9" -> 203.0.113.9   (appended by our one proxy)
```

**Why the key is `sub` for authenticated requests.** Q11 sends every browser's traffic
through the Next.js server, so the API sees Vercel's egress addresses, shared by all
users. Keyed by IP, one user would exhaust everyone's budget. The verified `sub` is a
per-person key the caller cannot choose (it is signed). Unauthenticated requests (the
health routes today; public profiles and search in M3/M6) are keyed by IP, which for
frontend-originated traffic is Vercel's (§8.4).

### 2.7 Published issues that touch this design

| Issue                                                                                      | Effect here                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [throttler#2709](https://github.com/nestjs/throttler/issues/2709) (open)                   | Two named throttlers sharing one storage key: the second gets `NaN` hits and **never blocks**. Only with a custom `generateKey` that omits the name. We keep the default key; a test proves each budget blocks on its own. |
| [throttler#2718](https://github.com/nestjs/throttler/issues/2718) (closed 2026-09-25)      | `normalizeIp` merged NAT64 clients into one tracker. IPv4 compose/host networks here; not affected.                                                                                                                        |
| [throttler#2669](https://github.com/nestjs/throttler/issues/2669) (closed)                 | Nest 12 peer range: fixed in 6.7.1.                                                                                                                                                                                        |
| [nextjs-auth0#2036](https://github.com/auth0/nextjs-auth0/issues/2036) (open)              | No hook for a failed refresh; the frontend catches `AccessTokenError` (`failed_to_refresh_token`, `missing_refresh_token`) and sends the user to login.                                                                    |
| [nextjs-auth0#2781](https://github.com/auth0/nextjs-auth0/issues/2781) (closed 2026-09-14) | `auth0.middleware()` crashed from the proxy/middleware path; the frontend upgrades to the latest 4.x and checks it.                                                                                                        |
| [nextjs-auth0#2477](https://github.com/auth0/nextjs-auth0/issues/2477) (closed)            | `getAccessToken(req, res, { refresh: true })` in a Next 16 proxy on Node failed on `Headers.append`; fixed upstream, re-check on the pinned version.                                                                       |
| jose: `createRemoteJWKSet` issues (#687, #702, #844)                                       | Runtime-specific (Bun, Supabase Edge, multiple JWKS endpoints); none on Node 24 with one issuer.                                                                                                                           |

## 3. Design

### 3.1 Request pipeline

```
Express (prefix /v1, body limit, trust proxy)
 └ global guards, in this order (one module, listed in order):
    1. AccessTokenGuard  @Public() → skip. Else parse "Authorization: Bearer <jwt>",
                         verify (§3.3), set req.auth = { sub, claims }.
    2. RateLimitGuard    key = req.auth ? "user:" + sub : "ip:" + req.ip (§3.6)
    3. CurrentUserGuard  @Public() → skip. Else resolve or provision the row (§3.4),
                         sync `verified`, set req.user.
 └ handler: @CurrentUser() reads req.user (synchronous; never re-queries)
```

- **Protected by default.** A route without `@Public()` requires a valid token. Public
  today: `HealthController` (`/healthz`, `/readyz`). `/docs` and `/docs-json` are
  Swagger's Express middleware, outside Nest's guards, so they stay public by
  construction; a test asserts all four answer without a token.
- The throttle runs **after** verification so it can key by `sub`, and **before**
  provisioning so a flood from one user never reaches MySQL. Invalid tokens are
  refused before the throttle: the cost of a refusal is one local signature check
  (or none, for a malformed token or a disallowed `alg`) and at most one JWKS fetch per
  30 s (§2.2).
- An unmatched path is 404 with or without a token (Nest's router answers before
  guards). The route list is public (`openapi.yaml`), so this discloses nothing.
- No CORS middleware: the only caller is a server (Q11). A browser `fetch` from another
  origin fails the CORS check.

### 3.2 Configuration (`src/core/config/schema.ts`)

| Variable                  | Rule                                                                                                                                                                                                                                                                          | Default |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `AUTH0_ISSUER_BASE_URL`   | required; URL with no path, query or fragment; `https:` (`http:` allowed only when `NODE_ENV` ≠ production, for the local JWKS in tests and Phase 3). **Normalized to origin + `/`**, so `https://x.auth0.com` and `https://x.auth0.com/` both become `https://x.auth0.com/`. | —       |
| `AUTH0_AUDIENCE`          | required, non-empty, trimmed                                                                                                                                                                                                                                                  | —       |
| `AUTH0_JWKS_TIMEOUT_MS`   | int 100–30,000                                                                                                                                                                                                                                                                | 3000    |
| `AUTH0_CLOCK_TOLERANCE_S` | int 0–60                                                                                                                                                                                                                                                                      | 5       |
| `TRUST_PROXY`             | `false`, or a hop count 1–10. **`true` fails at boot** with "use a hop count". Existing `false` keeps working.                                                                                                                                                                | `false` |
| `RATE_LIMIT_WINDOW_S`     | int 1–3600                                                                                                                                                                                                                                                                    | 60      |
| `RATE_LIMIT_DEFAULT`      | int ≥ 1, per window, per route, per client                                                                                                                                                                                                                                    | 120     |
| `RATE_LIMIT_SEARCH`       | same, for routes that opt into `search` (M6)                                                                                                                                                                                                                                  | 30      |
| `RATE_LIMIT_IMPORT`       | same, `import` (M7)                                                                                                                                                                                                                                                           | 5       |
| `RATE_LIMIT_AI`           | same, `ai` (M8)                                                                                                                                                                                                                                                               | 10      |

The issuer the token must carry is the normalized one; a token whose `iss` lacks the
slash fails (exact compare, §2.3). The JWKS URL is derived: `<issuer>.well-known/jwks.json`
(no discovery fetch, one fewer network dependency). `.env.example`, compose and the CI
stack job get the new variables (placeholder issuer in CI; the stack job only hits health).

### 3.3 Token verification and error mapping

`src/core/auth/access-token.ts` (framework-free, depends on `jose` and config only):
`createAccessTokenVerifier(cfg)` builds the remote JWKS once and returns
`verify(token) → VerifiedToken { sub, claims }`. Claims are parsed with zod, each
optional, lengths bounded; a malformed claim is dropped, not trusted.

| Outcome                                                                          | Status | Body                                                                                | Log (warn/error, fixed message `access token rejected` / `token keys unavailable`)                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no `Authorization`, not `Bearer <token>`                                         | 401    | `{"code":"UNAUTHENTICATED","message":"authentication required"}`                    | reason `missing`                                                                                                                                                                                                                                                                                                                                                                                    |
| any `JOSEError` from `jwtVerify` (every case in §2.3)                            | 401    | same                                                                                | reason = our code per class: `JWSInvalid`/`JWTInvalid` → `malformed`, `JOSEAlgNotAllowed` → `alg`, `JOSENotSupported` → `unsupported`, `JWSSignatureVerificationFailed` → `signature`, `JWTExpired` → `expired`, `JWTClaimValidationFailed` → `claim:<claim>`, `JWKSNoMatchingKey`/`JWKSMultipleMatchingKeys` → `unknown-key`, other `JOSEError` → `invalid`; **never** the jose message or payload |
| `KeySourceUnavailable` (timeout, refused, DNS, non-200, bad JSON, `JWKSInvalid`) | 503    | `{"code":"AUTH_UNAVAILABLE","message":"authentication is temporarily unavailable"}` | cause class + `code` of the wrapped error (`JWKSTimeout`, `TypeError`)                                                                                                                                                                                                                                                                                                                              |
| anything else                                                                    | 500    | `INTERNAL_ERROR` (existing)                                                         | existing                                                                                                                                                                                                                                                                                                                                                                                            |

401 responses carry `WWW-Authenticate: Bearer` (RFC 6750 §3), with no error detail.
The body is identical for every 401 reason, so the response tells a caller nothing
about why their token failed.

### 3.4 Identity and provisioning

`src/api/users/`: `repositories/user.repository.ts` (Kysely), `services/provisioning.service.ts`.

1. `findByAuth0Id(sub)`: plain `SELECT` outside a transaction. Hit → step 3.
2. Miss → `inTransaction(db, trx => provision(trx, sub, prefill))`:

   ```sql
   INSERT INTO users (id, auth0_id, name, email, avatar_url, headline, verified)
   VALUES (?, ?, ?, ?, ?, ?, ?)            -- id = newId()
   ON DUPLICATE KEY UPDATE id = id;
   SELECT … FROM users WHERE auth0_id = ? FOR SHARE;   -- the row, whoever inserted it
   ```

3. `verified` differs from the token's `email_verified` (absent = false) →
   `UPDATE users SET verified = ? WHERE id = ? AND verified <> ?` (idempotent; a
   concurrent sync to the same value is a no-op).

**Pre-fill** (namespace `https://gradfolio.app/`, the Action in auth0-setup §6):

| Column       | From                                                           | Rule (validators from `src/core/validation`)                                                                                    |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | `name` claim → email local part → `Gradfolio user`             | trimmed; cut to 255 **code points** (`VARCHAR(255)`); Auth0 sets a database user's `name` to the email, taken as-is             |
| `email`      | `email` claim                                                  | ≤ 255 code points and contains `@`, else NULL. It is the contact email M3 lets the user edit, so it is written only at creation |
| `avatar_url` | `picture` claim                                                | `httpUrl` (http/https only) and `TEXT` byte limit, else NULL                                                                    |
| `headline`   | `headline` claim, **only** when `sub` starts with `linkedin\|` | ≤ 500 code points, else `''`. Expected absent (§8.2)                                                                            |
| `verified`   | `email_verified === true`                                      | re-synced (step 3)                                                                                                              |
| `id`         | `newId()`                                                      | M1 rule                                                                                                                         |

External data is **cut or dropped, never rejected**: a login must not fail because a
provider sent a 300-character name. If the token has none of the profile claims (the
Action missing), provisioning still succeeds with the fallback name and logs one warn,
`token carries no profile claims` (no values), so a misconfigured tenant is visible.

### 3.5 `GET /v1/me`

`src/api/me/`: `me.module.ts`, `me.controller.ts`, `dto/me.dto.ts` (the zod schema the
OpenAPI document uses).

```json
{
  "id": "0b6f…",
  "name": "Ani Petrosyan",
  "email": "ani@example.com",
  "avatarUrl": "https://lh3.googleusercontent.com/…",
  "headline": "",
  "verified": true,
  "isPublic": true,
  "identities": ["google-oauth2"]
}
```

- `email`, `avatarUrl` nullable. `identities`: the providers from the `identities`
  claim, else `[provider of sub]`. `auth0_id`, `phone`, `birthday` are not returned.
- Responses: 200; 401 `UNAUTHENTICATED`; 429 `RATE_LIMITED`; 503 `AUTH_UNAVAILABLE` or
  `DATABASE_UNAVAILABLE`.
- `openapi.yaml`: operation `getMe` in `OPERATIONS`, a `bearerAuth` security scheme
  (HTTP bearer, JWT) applied to every non-public operation; `document.test.ts` keeps
  checking served ⇄ documented both ways.
- `http/me.http`: the request with `Authorization: Bearer {{$dotenv accessToken}}`,
  plus the no-token 401. `.env` holds the token locally (gitignored).

### 3.6 Rate limiting

`src/api/rate-limit/`: `RateLimitGuard extends ThrottlerGuard`, `@RateBudget(name)`.

- `ThrottlerModule.forRoot` gets `default`, `search`, `import`, `ai` with limits from
  config and `ttl = RATE_LIMIT_WINDOW_S`. `search`/`import`/`ai` have
  `skipIf: route has no @RateBudget(<name>)`. `default` applies everywhere.
- `getTracker`: `user:<sub>` when `req.auth` is set, else `ip:<normalized req.ip>`.
  `generateKey` is **not** overridden (throttler#2709).
- `setHeaders: false`. `throwThrottlingException` is overridden to set a standard
  `Retry-After: <seconds>` and throw `AppError('RATE_LIMITED', 'too many requests', 429)`.
- `app.set('trust proxy', cfg.TRUST_PROXY)` with `false` or the hop count.

### 3.7 Logging and redaction

- The token is only ever in `req.headers.authorization` (already redacted). The verifier
  never puts the token, the payload or a jose message into an error or a log field:
  log fields are `reason` (our code), and for 503 the cause class and code.
- `req.auth` and `req.user` are never logged. `REDACT_PATHS` gains `*.email` and
  `*.claims`, so a future handler that logs a user or claims object does not write an
  email address.
- A test runs every rejection case through the app with a captured log stream and
  asserts neither the token, nor any claim value, nor any jose message text appears.

## 4. Security properties and their proofs

Every guard ships with a test that fails when it is removed (Phase 3 table).

| Property                                                            | Test that fails without it                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RS256 only                                                          | `alg: none`, HS256-with-public-key, RS512 → 401. jose would refuse these anyway, so the test asserts the reason `alg`: without `algorithms`, HS256 becomes `unsupported` and RS512 `unknown-key`, and it fails.                                                         |
| Issuer fixed, trailing slash exact                                  | wrong `iss` → 401; `iss` without the slash → 401; config without the slash still accepts a correct token                                                                                                                                                                |
| Audience fixed; array form accepted                                 | wrong `aud`, ID-token `aud` → 401; `[ours, userinfo]` → 200                                                                                                                                                                                                             |
| Expiry required and enforced                                        | expired → 401; **no `exp` → 401**; 3 s past with tolerance 5 → 200; tolerance from config                                                                                                                                                                               |
| `nbf` enforced                                                      | `nbf` +60 s → 401                                                                                                                                                                                                                                                       |
| Signature against the JWKS                                          | other key same `kid`, tampered payload, unknown `kid` → 401                                                                                                                                                                                                             |
| Key rotation                                                        | new `kid` published → accepted after the cooldown (cooldown shortened in the test via the verifier's options)                                                                                                                                                           |
| Outage is 503, not 401                                              | JWKS hanging (timeout), refused, 500, bad JSON, invalid set → 503 `AUTH_UNAVAILABLE`, each produced by a real HTTP server / closed port                                                                                                                                 |
| Every jose error class maps as documented                           | a table test: each class in §2.2/§2.3 produced for real, through `verify`, asserted status + reason                                                                                                                                                                     |
| No library text in response or log                                  | each case above through the app with a captured log: body equals the fixed body; the log has no token, no claim value, no jose message                                                                                                                                  |
| Protected by default; health and docs public                        | a test controller without `@Public()` → 401; `/healthz`, `/readyz`, `/docs`, `/docs-json` → 200 without a token; removing `@Public()` from health → its test fails                                                                                                      |
| `TRUST_PROXY=true` refused; spoofed XFF ignored                     | config test; app test: 4th anonymous request with a new `X-Forwarded-For` each → 429                                                                                                                                                                                    |
| Default budget → 429 `RATE_LIMITED` + `Retry-After`                 | app test; removing the override → header `Retry-After` missing / body code differs                                                                                                                                                                                      |
| Budgets per user, not per shared IP                                 | alice exhausted → bob (same IP) still 200                                                                                                                                                                                                                               |
| Named budgets apply only where opted in, and each blocks on its own | `search` route blocks at its limit; a route without `@RateBudget` never sees `search`; two budgets on one route both block (throttler#2709)                                                                                                                             |
| Throttle before provisioning                                        | int: exhaust `sub` X's budget on `/v1/me`, delete X's row, request again → 429 and still **no row**. With provisioning before the throttle the row comes back.                                                                                                          |
| One row per `sub` under a race                                      | int, barrier: holder + two `/v1/me` requests over HTTP; holder commits → both get the holder's id; holder rolls back → one inserts, the other deadlocks and is retried, both same id, `COUNT(*) = 1`. Fails without ODKU (1062 → 500) or without the retry (1213 → 500) |
| Locking re-read                                                     | int: `provision` called inside a transaction that read first, competitor committed meanwhile → returns the row; fails with a plain `SELECT` (`NO ROW`)                                                                                                                  |
| Ids from the app                                                    | the inserted id is the one `newId()` produced (int)                                                                                                                                                                                                                     |
| Pre-fill cut, never rejected                                        | 300-char name, 256-char email, `javascript:` picture, over-long headline → row created, values cut / NULL                                                                                                                                                               |
| Existing rows not overwritten                                       | second token with a different `name` → stored name unchanged                                                                                                                                                                                                            |
| `verified` follows `email_verified`                                 | false → true → false across three tokens                                                                                                                                                                                                                                |
| `/v1/me` returns only the caller's row                              | users A and B: each gets their own id; neither sees the other                                                                                                                                                                                                           |

## 5. Phase 3 (from the handoff), what each step needs

- Rejection matrix and outage against the **running** API: the compose api points at a
  local JWKS server on the host (`AUTH0_ISSUER_BASE_URL=http://host.docker.internal:<port>/`)
  that the verification script also signs with; outage = same with the server stopped.
- Real Auth0 token: Levon's `.env` (`AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`,
  `M2_TEST_TOKEN_<CONNECTION>`, auth0-setup §7); never printed, never committed. Connections recorded as
  tested / not tested.

## 6. Pull requests

1. **This plan** (docs only): `docs/m2-plan.md`, `docs/auth0-setup.md`.
2. **(a) Token guard, config, errors, throttler:** config and its tests; the `core/auth`
   verifier, its errors and tests (local JWKS helper in `src/testing/`);
   `AccessTokenGuard`, `@Public()` (health); `RateLimitGuard`, `@RateBudget`;
   `TRUST_PROXY` hop count; `AUTH_UNAVAILABLE` / `RATE_LIMITED` mapping; redaction;
   `.env.example`, compose, CI env; CLAUDE.md commands and facts.
3. **(b) Provisioning and `/v1/me`:** user repository + provisioning + race tests;
   `CurrentUserGuard`, `@CurrentUser()`; `GET /v1/me`; verified sync; OpenAPI (operation,
   bearer scheme), `http/me.http`; `docs/m2-verification.md`.

## 7. Out of scope

The `gradfolio` repo (§11 is its spec); profile editing (M3); GitHub/LinkedIn API
access and the GitHub part of `verified` (M7); account deletion (M3); a shared
rate-limit store; stale-while-error JWKS caching; per-client limits for anonymous
traffic arriving through Vercel (§8.4).

## 8. Contradictions and findings

1. **Audience: investigation §4.2 vs the tracker.** §4.2 says `audience` is set; the
   live check says none is sent. Both are right: the code passes
   `process.env.AUTH0_AUDIENCE`, which is unset in production.
2. **LinkedIn headline (Q8, 2.14, 7.10).** Q8 says LinkedIn sign-in gives "name,
   headline, photo, email". LinkedIn's OIDC product returns no headline (§2.1), and it
   is the only self-serve sign-in product. The API accepts a `headline` claim for a
   `linkedin|` subject if one ever arrives; Phase 3 records whether it does. Expected:
   headline pre-fill is not possible; the tracker text should say "name, photo, email".
3. **"A global default" rate limit.** The throttler's default budget is per route per
   client (its key includes class and handler), and named budgets apply to every route
   unless skipped. The plan uses "default on every route" and opt-in named budgets.
4. **`TRUST_PROXY=true` is spoofable** (§2.6), which contradicts "a client cannot choose
   its own IP". It becomes a hop count.
5. **IP-keyed limits vs Q11.** All frontend traffic comes from Vercel's addresses.
   Authenticated traffic is keyed by `sub`; anonymous traffic by IP remains coarse
   (see 8.4).
6. **2.5's test list** lacks `nbf`, a missing `exp`, and the issuer slash. jose accepts a
   token with no `exp` unless `requiredClaims` names it (§2.3).
7. **`/auth/access-token`** is on by default in the SDK, which contradicts Q11's
   "token kept server-side"; the frontend turns it off.
8. **Next.js 16:** the frontend's `middleware.ts` is the deprecated name (`proxy.ts`).

Accepted limitations:

- **8.3** After `cacheMaxAge` (10 min) with the JWKS down, every request is 503.
- **8.4** Anonymous requests from the frontend all share Vercel's IP bucket. M6
  (public search) revisits it, for example with a per-visitor header signed by the
  frontend.

## 9. Proposed tracker changes (for the orchestrator)

- Q7 → decided (§1). Q11 → decided (§1), plus "`/auth/access-token` disabled".
- Q8 text: LinkedIn sign-in gives name, photo, email (**no headline**); 2.14 and 7.10
  drop "headline" unless Phase 3 shows it arriving.
- 2.3 → decided as proposed in §1 (two tenants, created in M9; no automatic linking),
  pending Levon.
- 2.4 → "Action adds namespaced claims" (decided).
- 2.5 test list: add `nbf`, missing `exp`, issuer slash, `aud` array, unknown `kid`,
  outage → 503.
- 2.7: "default budget per route per client; `search`/`import`/`ai` opt-in; keyed by
  `sub` when authenticated".
- New follow-ups: anonymous rate limiting behind Vercel (M6); `TRUST_PROXY` hop count on
  the M9 host (9.2); tokenRefreshBuffer / refresh in `proxy.ts` (fe).

## 10. Frontend notes (for the `gradfolio` session, tasks 2.8–2.15)

| Topic               | What to do                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audience and scope  | `AUTH0_AUDIENCE` = the API identifier from auth0-setup §2 (proposed `https://api.gradfolio.app`), set locally and on Vercel (production and preview). Leave `AUTH0_SCOPE` unset (default `openid profile email offline_access`) or set exactly that. Confirm the `/authorize` URL carries `audience=` (2.8).                                                                                                      |
| SDK version         | Upgrade `@auth0/nextjs-auth0` to the latest 4.x (4.30.0 today) for `tokenRefreshBuffer` and the proxy fixes (§2.7); re-run the checks below on it.                                                                                                                                                                                                                                                                |
| Getting the token   | Server only: `const { token } = await auth0.getAccessToken()` in Server Components, Route Handlers, Server Actions. In `proxy.ts` (rename from `middleware.ts`), for protected routes, refresh when the token is within 60 s of expiry: `await auth0.getAccessToken(req, authRes, { refresh: true })`, because a Server Component cannot persist a refreshed token. On 4.30, also `tokenRefreshBuffer: 60`.       |
| Keep it server-side | `new Auth0Client({ enableAccessTokenEndpoint: false, … })`. Never pass the token to a Client Component. The API has no CORS.                                                                                                                                                                                                                                                                                      |
| Base URL            | `GRADFOLIO_API_URL` (server-only, no `NEXT_PUBLIC_`): locally `http://127.0.0.1:3001` (the frontend's `next dev` takes 3000, so run the API with `API_HOST_PORT=3001` / `API_PORT=3001`); the M9 host in production. All paths under `/v1` except health.                                                                                                                                                         |
| Error envelope      | Every failure is `{ code, message }` (plus `details` for `VALIDATION_FAILED`). Branch on `code` only. `UNAUTHENTICATED` (401): no/invalid token → treat as logged out, go to `/auth/login`. `AUTH_UNAVAILABLE` / `DATABASE_UNAVAILABLE` (503): transient, show a retry. `RATE_LIMITED` (429): honour `Retry-After`. `AccessTokenError` from the SDK (`missing_refresh_token`, `failed_to_refresh_token`) → login. |
| Route policy (2.10) | Public (no login): `/`, `/profile/[id]`, `/projects/[id]`, `/search`, browse pages. Login required: dashboard, profile editing, `/projects/new`, project edit, integrations, account. The proxy redirects to `/auth/login` for those, and **fails closed** on error (2.11).                                                                                                                                       |
| Current user (2.12) | `GET /v1/me` replaces `u_001`. `isOwnProfile = me.id === profile.id`. The first call creates the row, so call it once after login (e.g. the dashboard) before any other API call that needs the user.                                                                                                                                                                                                             |
| Pre-fill (2.14)     | `/v1/me` returns `name`, `email`, `avatarUrl` pre-filled from Auth0 (Google/GitHub/LinkedIn/database); `headline` is `''` (LinkedIn does not provide one, §8.2). The onboarding stepper shows them for confirmation; editing is M3 (`PATCH /v1/me/profile`).                                                                                                                                                      |
| Types               | From `openapi.yaml` (Q5, `openapi-typescript`): `getMe` response and `ErrorResponse`.                                                                                                                                                                                                                                                                                                                             |
| Env docs (2.15)     | v4 names: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`, `AUTH0_AUDIENCE`, `GRADFOLIO_API_URL`; `.env.example` with placeholders.                                                                                                                                                                                                                                      |
| Previews            | `APP_BASE_URL` per preview = the branch alias (`https://${VERCEL_BRANCH_URL}`), added to Auth0's callback/logout lists (auth0-setup §4). Never `*.vercel.app`.                                                                                                                                                                                                                                                    |
