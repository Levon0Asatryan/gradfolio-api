# M7 plan: GitHub and LinkedIn import (API)

Tracker 7.1–7.8, the API halves of 7.10 and 7.12, `githubStars`, plus Levon's additions:
dynamic suggestions (PR d) and a list of other integrations (§12). `main` is at `5fe23dc`.

Evidence labels: **run** = executed on 2026-10-10/11 (MySQL 8.4.11 on compose project
`gradfolio-m7`, port 3315; GitHub's public API unauthenticated; yauzl 3.4.0, Node 24.20);
**docs** = read from the vendor's documentation on 2026-10-11, not executed; **unverified** =
needs the Auth0 tenant or a real export, and is listed in §14. The Auth0 MCP server did not
connect in this session, so nothing was run against the tenant.

## 0. What Levon decides

| ID  | Decision                         | Options                                                                                                                                                                                  | **Recommendation**                                                                                                                                                                                                                                                |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 7.1 token source                 | A1 Auth0 IdP token via Management API; A2 Auth0 Token Vault; B GitHub OAuth App or GitHub App run by the API                                                                             | **A (your direction), stored nowhere.** Build A1 behind one `GithubTokenSource` interface; a 20-minute tenant spike (§2.1) decides whether A2 replaces it. B is kept as the documented fallback (§1.3).                                                           |
| D2  | Cache the token or not (7.2)     | fetch on demand, in memory 5 min; encrypted copy in MySQL                                                                                                                                | **On demand, in memory only.** No token ever reaches MySQL, a log or a response. The AES-GCM/rotation machinery is not built (§2.4); a DB `CHECK` makes a stored token impossible.                                                                                |
| D3  | README images (7.5)              | (1) drop every image, keep alt text; (2) allow `<img>` limited to GitHub hosts, relative ones rewritten to `raw.githubusercontent.com`                                                   | **(1).** No change to M4's allow-list or the frontend's sanitizer; works for private repos; no hot-linking. Relative **links** are rewritten to `github.com/<owner>/<repo>/blob/<ref>/<path>` (§3.4). Screenshots belong in M4 attachments.                       |
| D4  | LinkedIn fixtures (7.6)          | F1 synthetic fixtures from header-only inspection of real exports; F2 wait for real files; F3 Levon pastes header lines himself                                                          | **F1.** A script prints file names that match the four datasets and each one's first line only; I build synthetic CSVs with those headers. PR (c) does not merge until headers are verified (or you accept the risk in writing).                                  |
| D5  | `verified` and GitHub (7.12)     | email verified **and** GitHub; email verified **or** GitHub                                                                                                                              | **Or.** Spec §3 and §5: "email/phone confirmed, or LinkedIn/GitHub linked". Tracker 2.16's "+" is read as "or".                                                                                                                                                   |
| D6  | GitHub scopes                    | public only (no extra scope); `repo` for private repos                                                                                                                                   | **Public only in v1.** Auth0's GitHub connection is an OAuth App: `repo` is read **and write** to every private repo and cannot be narrowed (§1.3). Private repos wait for a GitHub App (follow-up). Spec §2 asked for a private-repo permission; this defers it. |
| D7  | Suggestions (PR d)               | in v1; later                                                                                                                                                                             | **Build, lazy polling** (on dashboard/integrations visit, 15 min floor). No scheduler, no new infra (§6). Webhooks are not possible under A.                                                                                                                      |
| D8  | Stars/forks/language on re-sync  | suggestion; refresh silently                                                                                                                                                             | **Refresh silently.** They are system-owned columns the user cannot edit, so nothing of theirs is overwritten. Only user-editable fields (title, summary, description, technologies) go through suggestions or the 7.4 rules.                                     |
| D9  | Disconnect and GitHub revocation | (1) revocation required: the OAuth App's client id and secret are required config, disconnect succeeds only once GitHub confirms; (2) best effort, and the tracker's M7 exit is reworded | **(1).** The M7 exit says "Disconnecting deletes the tokens". Under A the token lives in Auth0 and Auth0 cannot revoke it (§2.5), so only GitHub's grant delete removes it. (2) would need your sign-off on the tracker change.                                   |

D4 (fixtures) and D1 change the shape of PR (a) and (c). The rest do not block starting.

## 1. Investigation

### 1.1 The code on `main`

- `integrations` (0001): `access_token`, `refresh_token`, `token_expires_at`, `external_user_id`,
  `last_synced_at`, `status`; `UNIQUE (user_id, integration_type)`. Nothing in `src/` reads or
  writes it except the seed (no tokens) and `AccountService` (cascade on delete).
- `projects` (0004) already has `source`, `is_draft`, `github_repo_id` (`UNIQUE (user_id,
github_repo_id)`), `repo_stars`, `repo_forks`, `repo_language`, `repo_readme_url`. `PATCH` rejects
  every `repo*` field except `repoUrl`. The detail DTO exposes `source`; `githubRepoId` is
  deliberately private.
- `ProjectWriteService.create` takes only client fields, so import needs its own insert in the same
  service layer: user lock, cap count, `insertProject`, `setProjectTerms`. It skips `recordActivity`
  at import (ten drafts would be ten feed entries); `projectPublished` fires on the later `PATCH`.
- `UsersService.resolve` re-syncs `users.verified` from the token's `email_verified` on **every**
  request, so a GitHub-based `verified` must be part of that computation or it is overwritten (§5).
- M4 storage: `FileStorage` has `signUpload/stat/readHead/claim/delete/list`, keys `u/<userId>/…`,
  the sweep scans `u/` only, and the bucket has **no lifecycle rule**. A ZIP needs ranged reads
  (`openRange`) and its own prefix (`imports/<userId>/`).
- Sanitizer allow-list has no `img`, `table` or `picture`. `sanitizeDescription` is the only way to a
  `SanitizedHtml`.
- Dashboard `githubStars = SUM(repo_stars)` over **non-draft** projects, `null` if none (M6 D3).
  Imported drafts count once published.
- Rate budgets exist for `import` (5/min) and `lookup`; `RateBudgetName` needs `integration`.
- `AccessTokenIdentity.identities` is the provider list the Action puts in the access token.
- Account deletion cascades `integrations` but has no hook for outside revocation.

### 1.2 GitHub facts (run unless marked)

| Probe                                                                       | Result                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /repos/{o}/{r}/readme` with `Accept: application/vnd.github.html+json` | Rendered HTML (`<div id="readme">…`), 33 KB for `expressjs/express`, with an `ETag`.                                                                          |
| External image in that HTML                                                 | Rewritten to `https://camo.githubusercontent.com/<hash>/<hex>` (GitHub's proxy), original in `data-canonical-src`.                                            |
| Relative image (`sveltejs/svelte`)                                          | `<img src="assets/banner.png">`, **not** rewritten.                                                                                                           |
| Relative and root-relative links (`svelte`, `kysely`, `material-ui`)        | `href="LICENSE.md"`, `./CONTRIBUTING.md`, `/CONTRIBUTING.md`, `packages/svelte` kept as written.                                                              |
| Tags in the output                                                          | `a li strong span p div svg path h ul pre img code details summary picture source themed-picture article`; allow-list drops `svg`, `picture`, `table`, `img`. |
| Conditional request                                                         | `If-None-Match` with the `ETag` returned `304`. Unauthenticated, it still decremented the limit; **docs**: free only when authorized.                         |
| Events                                                                      | `GET /users/{u}/events/public` answers `x-poll-interval: 60` and an `ETag`.                                                                                   |
| Unauthenticated rate limit                                                  | 60/h, headers `x-ratelimit-limit/remaining/used/reset/resource`. Authenticated OAuth token: 5,000/h per user (**docs**).                                      |
| `DELETE /applications/{client_id}/token` and `/grant` without credentials   | 401 "Requires authentication". **docs**: Basic auth with client id and secret; a grant delete removes all of the user's tokens for that app.                  |
| Device-flow endpoint with a made-up client id                               | `{"error":"Not Found"}`.                                                                                                                                      |
| OAuth authorize                                                             | **docs**: `state`, PKCE `code_challenge` (S256) supported; code lives 10 minutes; empty scope = public data only.                                             |
| Secondary rate limits                                                       | **docs**: concurrent requests and bursts of mutations trigger them; serialise requests, honour `retry-after`.                                                 |
| Webhooks                                                                    | **docs**: GitHub's recommendation over polling. OAuth Apps have none; GitHub Apps do (§6.3).                                                                  |

**Consequence:** the README is fetched as HTML from the API (no markdown library), then goes
through a rewrite pass and `sanitizeDescription`. Images are all `camo` or relative; both are
dropped under D3.

### 1.3 The token source: three options (7.1)

Docs-based. Not run end to end: no throwaway GitHub account exists, the Auth0 MCP was down, and
B needs an app Levon registers. §2.1 lists what the spike runs.

| Question                   | A1 Auth0 IdP token (Management API)                                                                                                                                                                                                                                                                    | A2 Auth0 Token Vault (Connected Accounts)                                                                                                                                                                      | B GitHub OAuth App / GitHub App run by the API                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a token is obtained    | `GET /api/v2/users/{id}` with `read:user_idp_tokens` returns `identities[].access_token` (**docs**).                                                                                                                                                                                                   | User connects through the My Account API (`/auth/connect` in nextjs-auth0 with `enableConnectAccountEndpoint`); the API exchanges the user's access token at `/oauth/token` for the provider token (**docs**). | OAuth code flow handled by the API's own callback.                                                                                                 |
| Credentials added          | A second Auth0 M2M app (Client Credentials is off on `Gradfolio`, §10.2) holding `read:user_idp_tokens`: one secret that can read **every** user's GitHub token. `update:users` too if the API links accounts.                                                                                         | A "Custom API Client" with the Token Vault grant, tied to the API's identifier (**docs**). No `read:user_idp_tokens`.                                                                                          | GitHub client secret in Secret Manager; DB-held, encrypted tokens.                                                                                 |
| Users who sign up by email | Need **account linking**. auth0-setup §8 decided "none in v1"; link calls need `update:users` or a user-scoped token. Linking needs the user's credentials on both sides (**docs**). Plan page: "Not available" on Free; an Auth0 community answer says supported on all plans. **Unverified, spike.** | No linking: Connected Accounts does not create a second user (**docs**).                                                                                                                                       | Nothing to link: the connect flow is ours.                                                                                                         |
| Scopes                     | Set on the **connection**, so every GitHub login requests them. Public-only needs none beyond `read:user`, `user:email`. A per-request `connection_scope` is not in the authorize reference (**unverified**).                                                                                          | Per connect request (`scopes` takes precedence over the dashboard's, **docs**).                                                                                                                                | Per authorize request. OAuth App: `repo` is read+write for all private repos. GitHub App: read-only `Contents`+`Metadata` on repos the user picks. |
| Lifetime and refresh       | The token is the one GitHub issued at the user's last login. **docs**: "There is no standard way to renew identity provider access tokens through Auth0"; an OAuth App token does not expire. GitHub App tokens (8 h) would need a custom OAuth2 connection (**unverified**).                          | Stored with its refresh token; exchange returns `expires_in` (**docs**).                                                                                                                                       | OAuth App: no expiry. GitHub App: 8 h, refresh token 6 months, **single-use refresh needs a row lock** (**docs**).                                 |
| Revocation on disconnect   | Auth0 cannot revoke third-party tokens (**docs**). The API holds no client secret, so it cannot call GitHub's grant delete unless Levon also gives it the OAuth App secret (§2.5).                                                                                                                     | Deleting the connected account removes the tokens from the vault and "does not automatically revoke" at the provider (**docs**).                                                                               | Direct: `DELETE /applications/{id}/grant`.                                                                                                         |
| Rate limits                | Management API on Free: **2 requests/s, burst 2** (**docs**). A user's repo list = 1 Auth0 call + 1 GitHub call. M2M tokens: 1,000/month on Free; cached for the token's lifetime.                                                                                                                     | `/oauth/token` limits (not read). Token Vault: "2" on Free; Auth0 for AI Agents listed as add-on, so Free eligibility is **unverified**.                                                                       | GitHub 5,000/h per user; App rate limits scale with installs.                                                                                      |
| Webhooks (for 7.x/d)       | No: the OAuth App is Auth0's, not ours; per-repo hooks would need `admin:repo_hook` on every repo. Polling only.                                                                                                                                                                                       | Same.                                                                                                                                                                                                          | GitHub App: yes (`push`, `star`, `repository`). OAuth App: no.                                                                                     |
| What Levon clicks          | M2M app, GitHub OAuth App → Auth0 GitHub connection (own keys), link test (§12).                                                                                                                                                                                                                       | My Account API + MRRT + Token Vault toggle on GitHub, Custom API Client (§12).                                                                                                                                 | Register app, Secret Manager secret, Cloud Run env.                                                                                                |
| Outage coupling            | Imports need Auth0 Management API up and under 2 rps.                                                                                                                                                                                                                                                  | Needs Auth0 up.                                                                                                                                                                                                | Only GitHub.                                                                                                                                       |

**Recommendation: A, with the token held nowhere (D2).** Reasons:

1. It is what you decided, and it reuses the GitHub login the product already has: a student who
   signed up with GitHub (`sub = github|…`) needs no link and no second consent.
2. Nothing durable holds a credential: no key, no rotation, no backup copy of tokens, no S10.
3. Its blast radius is one secret (the M2M app). That is the price: that secret can read every
   user's GitHub token, so it gets exactly one scope, lives in Secret Manager, and is only ever used
   for `GET /users/{id}`.
4. The weak points are Auth0's: 2 requests/s, tokens we cannot renew or revoke, and (possibly)
   linking not on Free. B has none of them. If the spike shows linking is blocked on Free **and**
   Token Vault is unavailable, A only serves students who signed up with GitHub; at that point the
   recommendation flips to B and PR (a) is rewritten, not patched (the API surface in §7 stays).

**Not recommended: an encrypted cached copy (D2).** It would survive an Auth0 outage and save
Management API calls, but it adds a key, rotation, and a copy that goes stale when the user logs in
again (Auth0 holds the newer token) or revokes at GitHub. At tens of users the in-memory cache (5
min) removes the 2 rps problem on its own. The design is in §2.4 in case you overrule it.

## 2. Design: connect, token source, disconnect (7.1, 7.2)

### 2.1 Tenant spike (before PR (a) merges; needs Levon, 20 minutes)

Runs once on the real tenant, with the throwaway GitHub account Levon already uses for login:

1. Does the `GitHub` connection use **own keys** (a client id filled in) or Auth0 dev keys? Dev keys
   cannot be assumed to return usable tokens.
2. Create the M2M app (§12, M7-T2). From a GitHub-login test user, `GET /users/{id}` returns
   `identities[0].access_token`. Record `expires_in` of the M2M token (APIs → Auth0 Management API →
   Settings; default expected 86,400 s: with 1,000 tokens/month that is fine, at 3,600 s it is not).
3. Link a Google or database test user with the GitHub identity (`POST /users/{id}/identities`).
   Free plan: does it succeed? Does `identities` then include the token?
4. Token Vault: activate My Account API, toggle "Connected Accounts for Token Vault" on GitHub,
   connect from a test session, exchange. Free plan: allowed?
5. Revoke at GitHub, then fetch the token again: Auth0 still returns the stale one (expected).
6. Delete the same grant a second time and record GitHub's status (D9: it must count as revoked).
   Then log in with GitHub again and fetch: Auth0 must now return a fresh, working token
   (the reconnect path after a disconnect).

Outcome table: (2)+(3) pass → A1. (2) passes, (3) blocked, (4) passes → A2 for email users. (4)
passes alone → A2. Nothing passes for email users → GitHub-login users only, and B is reopened.

### 2.2 Token source (no persistence)

```
interface GithubTokenSource {
  /** The caller's GitHub access token; null when no GitHub identity is linked. */
  tokenFor(auth0Sub: string): Promise<GithubAccessToken | null>;
}
```

- `Auth0IdpTokenSource` (A1): M2M token from `POST {issuer}oauth/token` (client credentials, audience
  `{issuer}api/v2/`), cached in memory until 60 s before `exp`, single-flight. Then `GET
{issuer}api/v2/users/{sub}?fields=identities&include_fields=true`; take the identity with
  `provider === 'github'` (and `isSocial`).
- All Management API calls pass through one queue: concurrency 1, 500 ms spacing (2 rps is the
  tenant limit). A 429 honours `Retry-After`/`x-ratelimit-reset` and surfaces as
  `503 INTEGRATION_UNAVAILABLE` with `Retry-After`.
- The token is cached per `sub` for `GITHUB_TOKEN_CACHE_S` (default 300, max 900), at most 1,000
  entries, never persisted. `GithubAccessToken` is a class whose `toJSON`, `toString` and
  `util.inspect` return `[redacted]`, so a stray `JSON.stringify` or log of it prints nothing.
- Cleared on disconnect, on any GitHub `401`, and on account deletion.
- `TokenVaultTokenSource` (A2) would take the caller's bearer token (already verified by the guard)
  and exchange it. The background poll (§6) has no user token, so A2 needs the "privileged worker"
  exchange (**docs**) there. Not built unless the spike picks it.

### 2.3 Connect, link, disconnect

"Connected" is **our** consent flag (`integrations.status`), distinct from "an identity exists at
Auth0". Every token fetch re-verifies the identity; a missing one clears the flag and answers
`409 GITHUB_NOT_LINKED`.

`POST /v1/me/integrations/github/connect`
: caller's `sub` starts with `github|` or the token's `identities` includes `github`: verify through
the token source, set the flag, `{ "state": "connected", "login": "…" }`. Otherwise `{ "state":
"link_required", "nonce", "expiresAt" }`. The nonce is 32 random bytes; only its SHA-256 is stored
(`integration_nonces`: hash, user_id, expires_at 10 min), bound to the caller, single use.

Frontend (server side only, Q11): `/authorize?connection=github&nonce=<nonce>&prompt=login` in a
**separate transaction from the session**, so the primary session is untouched; its callback takes
the secondary `id_token` and forwards it to the API.

`POST /v1/me/integrations/github/link { idToken }`
: 1. verify `idToken`: RS256 only, signature against the JWKS, issuer, audience = the `Gradfolio`
client id (`AUTH0_CLIENT_ID`, new config), `exp`, `iat` within 5 minutes, `sub` starts `github|`; 2. `nonce` claim: consume the row (`DELETE … WHERE hash = ? AND user_id = ? AND expires_at >
UTC_TIMESTAMP()`, one row or 400 `INVALID_NONCE`), so it is the caller's own, unexpired, unused; 3. refuse with `409 GITHUB_ACCOUNT_IN_USE` when a `users` row with `auth0_id = <secondary sub>`
exists (that student logged into Gradfolio as GitHub-only; linking would orphan the row), or when
another Gradfolio user already holds this GitHub id (`UNIQUE (integration_type,
external_user_id)`); 4. `POST /api/v2/users/{callerSub}/identities` `{ link_with: idToken }` with
the M2M token (`update:users`); 5. flag, `external_user_id`, `external_login`, `verified`, all in
one transaction (§5.1). The id token is never logged and never stored.

`DELETE /v1/me/integrations/github`
: 1. Revoke first: fetch the token through the token source and `DELETE /applications/{id}/grant`
(§2.5). `204` counts as revoked, and so does the status GitHub gives for a grant that is already
gone (**unverified**: the docs list `422`; the §2.1 spike runs it and the code maps what it saw); no
linked identity in Auth0 also counts. Anything else (5xx, timeout, `401` on our client
credentials) answers `502 GITHUB_REVOKE_FAILED` and **changes nothing**, so the card still shows
"connected" and the student retries. 2. Then, in one transaction: flag off, `external_*` and `last_synced_at` cleared, open
suggestions with source `github` deleted, token cache entry dropped; `{ "status": "not_connected" }`.
A crash between 1 and 2 leaves a connected row whose token is dead: the next GitHub call gets `401`,
which already maps to `409 GITHUB_NOT_LINKED` (§3.1), and a repeated `DELETE` finds the grant gone
and finishes. Reconnecting needs one fresh GitHub login, which replaces the dead token Auth0 holds
(§2.1 step 6). Projects already imported stay (`source = 'github'`); re-sync then answers
`409 GITHUB_NOT_CONNECTED`. The Auth0 identity is **not** unlinked (a GitHub-only user would lose
their login; `update:users` is already a wide scope): the card says so.

### 2.4 If Levon overrules D2 (encrypted cached copy)

Not built. Sketch, so the cost is known (about +1 day, one more secret): AES-256-GCM, 12-byte random
nonce per value, `v1.<keyId>.<nonce>.<ciphertext>.<tag>` with AAD `integration|<type>|<userId>|<col>`,
key from Secret Manager (`INTEGRATION_KEY=k1:<base64>`, previous key as `INTEGRATION_KEY_PREVIOUS`),
`npm run integrations:rotate-key` with compare-and-swap per row, tests: column is not plaintext,
nonce never reused (injected source), old key decrypts after rotation. Unused by A.

### 2.5 Revocation at GitHub

Auth0 cannot revoke third-party tokens (**docs**), and the API has no client secret under A. To make
disconnect real, Levon would also give the API the GitHub OAuth App's client id and secret
(`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, Secret Manager). `DELETE /applications/{id}/grant`
(Basic auth, body `{access_token}`) then deletes the grant, which also kills the token Auth0 holds.
Side effect: the user sees GitHub's consent screen at their next GitHub login. **Required (D9)**:
the M7 exit says disconnecting deletes the tokens, and this is the only call that does. Without
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` every GitHub route answers `503
INTEGRATION_UNAVAILABLE`, so no student can connect an account the API could not disconnect. If you
take D9 option (2) instead, disconnect becomes best effort with `revokedAtGitHub: true|false` and
the tracker exit is reworded.

### 2.6 What is stored

`integrations(github)`: `status`, `external_user_id` (GitHub numeric id), new `external_login`,
`last_synced_at`. `access_token`, `refresh_token`, `token_expires_at` stay `NULL`, **enforced by a
`CHECK`** (0008), so S10 holds by construction. Nothing token-shaped in responses, logs or errors:
`REDACT_PATHS` already covers `*.access_token`; add `*.idToken`, `*.nonce`, `*.code`.

## 3. Import, re-sync, README (7.3–7.5)

### 3.1 GitHub client

One `GithubClient` over `fetch` with: base URL from config (`GITHUB_API_BASE_URL`, default
`https://api.github.com`, `https` required in production), `redirect: 'error'`, a timeout, a body
cap, `Accept`/`X-GitHub-Api-Version` pinned, the token in the `Authorization` header only. **The
only inputs a caller controls are integers** (`repoId`) and an opaque page cursor; no URL, host or
path from a user ever reaches `fetch` (SSRF, AGENTS). Responses are parsed with zod; unknown fields
are dropped.

Mapping (each through a fake GitHub server over real HTTP, with real header names, and the
unauthenticated real API for the `304` and `200` shapes):

| GitHub                                                                | API answer                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `401` (token revoked or deleted)                                      | `409 GITHUB_NOT_LINKED`, cache entry dropped                                    |
| `403`/`429` with `x-ratelimit-remaining: 0`, or `retry-after` present | `429 GITHUB_RATE_LIMITED`, `Retry-After` from `x-ratelimit-reset`/`retry-after` |
| `404` on `/repositories/{id}`                                         | that repo is `skipped: not_found` (not an error for the batch)                  |
| `5xx`, timeout, network                                               | `502 GITHUB_UNAVAILABLE`                                                        |
| anything else                                                         | `502 GITHUB_UNAVAILABLE`, status logged, body never logged                      |

`x-ratelimit-remaining` and `x-ratelimit-reset` from every response are returned to the caller as
`rateLimit: { remaining, resetsAt }` on the list and import responses.

### 3.2 List (7.3)

`GET /v1/me/github/repos?cursor&limit` → GitHub `GET /user/repos?affiliation=owner,collaborator&
sort=pushed&per_page=<limit>&page=<n>&visibility=public`. The cursor is the page number, opaque to
the caller. Each item: `repoId`, `fullName`, `description`, `language`, `stars`, `forks`, `fork`,
`archived`, `pushedAt`, `imported`, `projectId` (the caller's project when imported, from one
`github_repo_id IN (…)` query scoped to `user_id`). `limit` ≤ `GITHUB_PAGE_MAX` (30).

### 3.3 Import (7.3)

`POST /v1/me/github/import { repoIds: number[] }` (1 to `GITHUB_IMPORT_MAX_BATCH`, default 10;
strict body, positive safe integers, no duplicates).

1. For each id, **outside any transaction**, with concurrency 2: `GET /repositories/{id}` (re-reads
   stars, forks, language, `permissions`: the client's numbers are never trusted) and the README.
   A repo is importable only when `owner.id` is the caller's GitHub id **or** `permissions.push` is
   true. Without that, anyone could import a famous public repo as their own work and wear the
   GitHub badge.
2. One transaction: `lockUser`; count owned projects against `PROJECT_MAX_PER_USER`; read existing
   `github_repo_id`s; insert the missing ones with `source = 'github'`, `is_draft = 1`, `is_public =
!repo.private`, `title = name`, `summary = description` cut to the column, `description_html` =
   sanitized README, `repo_*`, `repo_url = html_url`, `technologies = [language]`; insert the
   `project_github_imports` snapshot (§3.5). The unique key is the backstop: a `1062` becomes
   `exists`, a `1213` reruns (`inTransaction`).
3. Response: per repo `created | exists | skipped` with `reason` (`not_found`, `not_owner`,
   `LIMIT_REACHED`, `README_TOO_LARGE` is a note on `created`, not a skip), `projectId`.

Run (§1.5): without the lock, two importers of one repo give `1062` to the loser and, when the
winner rolls back, `1213` to a waiter; a natural-key check-then-insert (used by confirm, 7.8)
produced **two rows**. The user lock removes both.

### 3.4 README (7.5)

1. `GET /repositories/{id}/readme` with `Accept: application/vnd.github.html+json`; reject above
   `GITHUB_README_MAX_BYTES` (default 400 KB) by `Content-Length` and by a streamed byte count.
2. Rewrite pass with `sanitize-html` (the same library, a pre-pass), base = `https://github.com/
<owner>/<repo>/blob/<default_branch>/` and the README's `path`:
   - `<a href>` relative or root-relative: resolved with `URL` against the base, then required to be
     `https://github.com/<owner>/<repo>/…`; anything that escapes (`../../x`) is dropped to a bare
     `<a>`;
   - `#fragment`, `mailto:`, `javascript:`, `data:`, protocol-relative: dropped;
   - absolute `http(s)` kept;
   - every `<img>`, `<picture>`, `<svg>`: removed, **alt text kept as text** (D3 option 1).
3. `sanitizeDescription` (M4's allow-list), then measured against
   `PROJECT_DESCRIPTION_MAX_BYTES`. Over the limit: description is `null`, the project is still
   created, the result carries `READMEs_TOO_LARGE`. Truncating HTML would risk a broken tree.
4. Tests (the decision is what is tested): a corpus of GitHub-rendered fixtures (`camo` image,
   relative image, relative and root-relative link, `../../` escape, `javascript:`, `data:` image,
   nested `picture`) expects no `<img`, rewritten links, and idempotence; plus the existing M4
   bypass corpus run on the pre-pass output.

If you pick option (2) instead: the pre-pass keeps `<img>` whose `src` host is
`camo.githubusercontent.com`, `raw.githubusercontent.com`, `avatars.githubusercontent.com` or
`user-images.githubusercontent.com`, relative ones become `raw.githubusercontent.com/<o>/<r>/<ref>/<p>`
(public repos only; private ones are dropped), **and** M4's allow-list gets `img` with `src`
restricted the same way and the frontend's DOMPurify config follows (a coordinated FE PR). Cost:
every description now accepts `<img>`, which widens the surface for hand-written HTML too.

### 3.5 Re-sync (7.4)

Table `project_github_imports` (`project_id` PK, FK cascade, `synced_at`, `snapshot` JSON): per
synced field the **SHA-256 of the value as written** (title, summary, descriptionHtml, repoUrl,
technologies as a sorted joined string). Hashes, not values: the new value comes from GitHub, the
old one is the row.

`POST /v1/me/projects/{id}/github/sync?dryRun=` (404 if not the caller's; `409 NOT_GITHUB_PROJECT`;
`409 GITHUB_NOT_CONNECTED`):

1. Fetch repo and README (outside the transaction).
2. Transaction: `lockOwnedProject` (`FOR UPDATE`, scoped to the caller), then per field compare
   `hash(current)` with the snapshot hash and `hash(github)` with it:

| current vs snapshot | GitHub vs snapshot | Outcome                                           |
| ------------------- | ------------------ | ------------------------------------------------- |
| equal               | equal              | `unchanged`                                       |
| equal               | differs            | `updated` (written, snapshot updated)             |
| differs             | equal              | `kept` (user's edit, nothing new upstream)        |
| differs             | differs            | `conflict`: **kept**, GitHub's new value reported |

3. System-owned columns (`repo_stars`, `repo_forks`, `repo_language`, `repo_readme_url`) always
   update (D8). Description writes go through `sanitizeDescription`.
4. Response lists `fields: [{ field, outcome }]` and the system values that changed. `dryRun` runs
   the same code and rolls back.

A rich-text editor that rewrites HTML without a text change counts as an edit: the safe direction.
The compare happens **under the lock**, so an edit committed while the sync waited is seen as an
edit. Barrier test: a `PATCH` committed between the sync's fetch and its lock survives.

## 4. LinkedIn export import (7.6–7.8, 7.10)

### 4.1 Real exports (7.6)

Real files are personal data: never committed, never pasted, never uploaded. M7-T1 collects them.
A script `scripts/linkedin-export-headers.mjs` (committed; the only thing that touches a real file)
prints, **to the terminal only**:

- entry names that exactly match one of the four dataset basenames, with their **first line**
  (truncated at 300 characters); for every other entry only the **extension histogram** and a count.
  Entry names can contain contact names, so no other name is ever printed;
- if a first line is not a header (a notes preamble), the script says so and stops: Levon pastes the
  header line himself (F3).

Until then the parser is written against **names I remember and have not verified**:

| Dataset        | File                 | Columns (unverified)                                                  |
| -------------- | -------------------- | --------------------------------------------------------------------- |
| positions      | `Positions.csv`      | `Company Name, Title, Description, Location, Started On, Finished On` |
| education      | `Education.csv`      | `School Name, Start Date, End Date, Notes, Degree Name, Activities`   |
| skills         | `Skills.csv`         | `Name`                                                                |
| certifications | `Certifications.csv` | `Name, Url, Authority, License Number, Started On, Finished On`       |

Open questions only real files answer: whether names or columns are localised for ru/am accounts
(each exporter notes their LinkedIn interface language); date formats (`Jan 2020`? `2020`?); where
the field of study is (our `education.field` is required); encoding and BOM; any preamble lines.
Fixtures (F1) are generated from the verified headers with invented rows.

### 4.2 Upload and parse (7.7)

The ZIP does **not** go through Next.js (Vercel: request body capped at **4.5 MB**, error `413
FUNCTION_PAYLOAD_TOO_LARGE`, docs 2026-08-24). Path:

1. `POST /v1/me/imports/linkedin/uploads { size }` → a signed `PUT` (existing M4 signer, type
   `application/zip`, exact size pinned, create-only precondition) for `imports/<userId>/<uuid>.zip`
   and `{ uploadId: <uuid> }`. Cap `IMPORT_MAX_ZIP_BYTES` (default 100 MB); at most
   `IMPORT_MAX_PENDING` (3) objects under the caller's `imports/` prefix.
2. The browser `PUT`s straight to the bucket (the existing CORS rule already allows `PUT` from the
   frontend origins).
3. `POST /v1/me/imports/linkedin/preview { uploadId }`. The key is **derived** from
   `<callerId>/<uploadId>`; another user's id simply finds no object (404). A client never names a
   key or URL.

Reading, per request, no file on disk (yauzl 3.4.0 with a random-access reader over GCS ranged
reads, so memory is the central directory plus one inflate window):

| Guard (config)                                                                                                                              | Code (all 422 unless noted)      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| object missing or not the caller's                                                                                                          | `IMPORT_UPLOAD_MISSING` (404)    |
| first bytes are not `PK\x03\x04` / `PK\x05\x06`                                                                                             | `IMPORT_NOT_ZIP`                 |
| stored size over `IMPORT_MAX_ZIP_BYTES`                                                                                                     | `IMPORT_TOO_LARGE` (413)         |
| entries over `IMPORT_MAX_ENTRIES` (5,000)                                                                                                   | `IMPORT_TOO_MANY_ENTRIES`        |
| sum of **declared** sizes over `IMPORT_MAX_UNCOMPRESSED_BYTES` (500 MB), or one entry over `IMPORT_MAX_ENTRY_BYTES` (10 MB for parsed ones) | `IMPORT_UNCOMPRESSED_TOO_LARGE`  |
| entry ≥ 1 MB with ratio over `IMPORT_MAX_RATIO` (100)                                                                                       | `IMPORT_RATIO_EXCEEDED`          |
| name absolute, `..` segment, backslash, NUL, drive letter, over 255 chars                                                                   | `IMPORT_UNSAFE_PATH`             |
| general-purpose bit 0 (encrypted)                                                                                                           | `IMPORT_ENCRYPTED`               |
| a recognised dataset name that is not `.csv`                                                                                                | `IMPORT_ENTRY_NOT_CSV`           |
| none of the four datasets present                                                                                                           | `IMPORT_EMPTY`                   |
| a dataset without its required columns                                                                                                      | `IMPORT_COLUMNS_MISSING` + names |
| unparseable CSV, a record over 64 KB, rows over `IMPORT_MAX_ROWS` (2,000)                                                                   | `IMPORT_MALFORMED_CSV`           |
| actual inflated bytes exceed the declared size                                                                                              | `IMPORT_UNCOMPRESSED_TOO_LARGE`  |
| more than `IMPORT_MAX_CONCURRENT` (2) previews running in the process                                                                       | `IMPORT_BUSY` (429)              |

Run (yauzl 3.4.0, scratch): a 200 MB-of-`A` entry compressed to 194 KB reports `uncompressedSize`
200,000,000 from the central directory **before any inflate**; `../evil.csv`, `/etc/passwd.csv`
and `..\evil.csv` are all rejected by the library (`invalid relative path` / `absolute path`); a
central directory that lies about the size (23 declared as 5) fails at read time with `too many
bytes in the stream`; the encrypted bit is visible per entry. So the two bomb guards work on the
declared sizes **and** on the stream, and traversal is rejected even if our own check is removed
(we keep ours as the one that has a stable code and a test).

Only the four recognised entries are inflated. Other entries are counted, never opened, and appear
in the response only as `skippedFileCount` and an extension histogram. **After** the preview, in a
`finally`, the object is deleted (success or any failure). A bucket lifecycle rule on `imports/`
(age 1 day, `docker/gcs-lifecycle.json`, M7-T7) catches a preview that never came, and the sweep CLI
gains `--prefix imports/`.

CSV parsing: `csv-parse` 7.x, `bom: true`, no `relax_quotes`, `max_record_size`, columns mapped by
**exact header name** (trimmed). An unrecognised column is skipped and its **name** reported
(`skippedColumns`), never guessed. Values are validated with the manual-entry schemas
(`createExperienceSchema` and friends); a row that fails is returned with `problems`, flagged, not
dropped. Dates: a month-and-year parses to `YYYY-MM`; a year-only experience date is a problem
(`DATE_NEEDS_MONTH`), because inventing a month is guessing.

Preview response: per section `items[]` with `status: new | duplicate | invalid`, the proposed
fields, `problems`; plus `skippedColumns`, `missingFiles`. Duplicate = same natural key as an
existing row (§4.3). Nothing is saved.

### 4.3 Confirm (7.8)

`POST /v1/me/imports/linkedin/confirm { experience[], education[], certifications[], skills[] }`.
The items are the preview's, possibly edited by the student in the wizard, **re-validated with the
manual-entry schemas** (the server does not trust the echo; a user could create the same rows by
hand). Stateless: nothing is held between preview and confirm.

One transaction under `lockUser`: for each section, drop items equal to an existing row on its
natural key, insert the rest in order; skills are the union with the existing list (case-insensitive,
the terms registry). Natural keys: experience `(lower(title), lower(organization), start)`;
education `(lower(institution), lower(degree), startYear)`; certifications `(lower(name),
lower(issuer), date)`. Caps (`PROFILE_MAX_SECTION_ITEMS`, `PROFILE_MAX_SKILLS`) are checked after
the dedupe: over the cap rolls back everything (`409 LIMIT_REACHED`). Then `integrations(linkedin)`
is upserted with `last_synced_at = now`, in the same transaction. Response: `added` and `skipped`
counts per section. A second identical confirm: all duplicates, `added: 0`.

Run (§1.5): the same check-then-insert **without** the lock produced 2 identical rows from two
concurrent confirms; with `lockUser` the second sees the first's row.

### 4.4 LinkedIn sign-in pre-fill (7.10)

Already built (m2-plan §3.4): name and photo from the token claims on the first request,
`headline` only if a `linkedin|` token carries it (expected absent, §8.2). Added: `GET
/v1/me/integrations` reports `linkedin: { status, lastSyncedAt }`, where `status` is `connected`
when the token's `identities` include `linkedin` or `sub` starts `linkedin|`. It is derived at read
time; the row only holds `last_synced_at`. **Cannot be public**: the API does not store a user's
identities, so another viewer's LinkedIn badge is not possible without a new column. Out of scope.

## 5. `verified` and the GitHub badge (7.12)

### 5.1 `verified`

`verified = emailVerified OR githubConnected` (D5). `findByAuth0Id` gains
`LEFT JOIN integrations ON user_id AND integration_type = 'github' AND status = 'connected'` (one
indexed lookup on every request, which already reads the user row), and `resolve` compares
`token.emailVerified || githubConnected` with the stored value. Link and disconnect set it in the
same transaction as the flag (disconnect: back to `token.emailVerified`). A test proves a GitHub-
connected user with an unverified email stays verified across requests (without the join, `resolve`
flips it to false on the next request).

### 5.2 GitHub source on projects

`source: 'github'` is already in the project DTO (M4). Added to the **detail** and summary of an
imported project: `repo: { stars, forks, language }` already exist; no new public field. The
profile response gains no GitHub field (the badge is the project's `source` plus the owner's
`verified`). `githubStars` is `SUM(repo_stars)` over published projects; a test imports two
fake repos, publishes one, and asserts the sum.

## 6. Suggestions (PR d, Levon's addition)

### 6.1 What it is

A persisted, per-user inbox of proposals computed from upstream data. The user accepts or dismisses
each. **Nothing is applied without an accept**, except system-owned counters (D8). It reuses 7.4's
compare rules: re-sync applies them on demand; suggestions store the same diff.

### 6.2 Signals, honestly

| Signal (kind)                                                           | Source                                       | Realistic?                                                                                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `project.new`: repo in the user's list that is not imported             | `GET /user/repos` (ETag)                     | Yes. Payload: the import preview. Accept = import as draft.                                                                          |
| `project.update`: description, README, title, language changed upstream | repo + README of **imported** repos only     | Yes, bounded: only repos whose `pushed_at`/ETag changed. Accept applies the field if the project's value still equals the base hash. |
| `skill.add`: a language on 2+ of the user's repos not in skills         | the list above                               | Yes. One suggestion per language, dedupe key `skill:<lowercase>`.                                                                    |
| `education.add`: verified email domain matches a configured university  | token `email` + `email_verified`             | Yes, small. `UNIVERSITY_DOMAINS` config (`npua.am=…`). Payload lacks degree/field/years: accept requires them (`overrides`).         |
| `experience.add`: GitHub `company` or public org membership             | `GET /user` `company`, `/users/{login}/orgs` | Low confidence, noisy (free text). Needs title and dates from the student. **Recommended out of PR (d)**; listed so it is a choice.  |
| `linkedin.reimport`: last export import over 90 days ago, or never      | `integrations.last_synced_at`                | Yes. A time-based reminder, dedupe key `linkedin:reimport:<year>-Q<n>`.                                                              |
| `profile.name`, `profile.avatar`: LinkedIn/GitHub claim changed         | token claims vs `integrations.claims_hash`   | Yes, only when the claim differs from the **current** profile value.                                                                 |
| LinkedIn diff against a new export                                      | the upload preview                           | Already the preview's `new/duplicate` statuses. Not persisted.                                                                       |

LinkedIn has no API (Q8). Nothing is pulled from it, ever. LinkedIn's member data-portability API is,
as far as I know, approval-gated and limited to EEA members (**unverified**); not usable here.

### 6.3 Polling under A

- **Webhooks: no.** The OAuth App behind Auth0's GitHub connection has none, and per-repo hooks
  would need `admin:repo_hook` on every repository. (A GitHub App would; this is the one capability
  B has that A cannot give.)
- **Conditional polling:** `GET /user/repos?sort=pushed` with the stored `ETag`
  (`integrations.poll_etag`). `304` costs no rate limit when authorized (**docs**; observed `304`).
  Per changed repo of an imported project: one `GET /repositories/{id}` and one README fetch.
  Honour `x-poll-interval` when present.
- **When:** lazily. `POST /v1/me/suggestions/refresh` (the frontend calls it on dashboard and
  integrations visits) runs at most once per `SUGGESTIONS_MIN_INTERVAL_S` (900) per user; inside the
  window it answers `{ refreshed: false, nextAllowedAt }`. No scheduler, no CPU-always instance.
  Optional later: Cloud Scheduler (3 free jobs) calling an OIDC-protected internal route. Not in
  this plan.
- Cost per refresh: 1 Management API call (cached 5 min), 1 conditional GitHub call, plus up to
  `SUGGESTIONS_MAX_REPOS` (10) detail calls. All behind the token queue.

### 6.4 Data model (migration 0009)

`suggestions`

| Column                      | Type                                             | Note                                                                                                 |
| --------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `id`                        | CHAR(36) PK                                      | backend-generated                                                                                    |
| `user_id`                   | CHAR(36) FK `ON DELETE CASCADE`                  | every read and write is scoped to it                                                                 |
| `kind`                      | VARCHAR(40)                                      | zod enum in code, not a MySQL ENUM (a new kind is not a migration)                                   |
| `source`                    | ENUM('github','linkedin','auth0')                | disconnect deletes the open rows of its source                                                       |
| `target_id`                 | CHAR(36) NULL                                    | the project, when the suggestion is about one                                                        |
| `dedupe_key`                | VARCHAR(190)                                     | `repo:<id>:new`, `repo:<id>:field:<name>:<hash8>`, `skill:<name>`, `linkedin:reimport:2026-Q4`       |
| `payload`                   | JSON                                             | proposed values + `baseHash`; written through `toJsonColumn`, size ≤ `PROJECT_DESCRIPTION_MAX_BYTES` |
| `status`                    | ENUM('open','accepted','dismissed','superseded') |                                                                                                      |
| `created_at`, `resolved_at` | DATETIME                                         |                                                                                                      |

`UNIQUE (user_id, dedupe_key)`: a poll is idempotent, and a **dismissed** suggestion with the same
key never returns. A new upstream value has a new hash, hence a new key; the older open one for the
same field becomes `superseded` in the same transaction. `INDEX (user_id, status, created_at)`.
Caps: `SUGGESTIONS_MAX_OPEN` (50) per user (oldest superseded); resolved rows purged after 90 days
(`npm run suggestions:purge`, same pattern as the sweep).

`integrations` gets `poll_etag VARCHAR(255)`, `polled_at DATETIME`, `claims_hash CHAR(64)`.

### 6.5 Endpoints

| Route                                       | Purpose                                                                  | Budget        |
| ------------------------------------------- | ------------------------------------------------------------------------ | ------------- |
| `GET /v1/me/suggestions?status=open&cursor` | the inbox, newest first; owner only                                      | `integration` |
| `POST /v1/me/suggestions/refresh`           | poll now (floor 15 min); returns the count of new ones                   | `import`      |
| `POST /v1/me/suggestions/{id}/accept`       | apply in one transaction, mark `accepted`; body `overrides` where needed | `integration` |
| `POST /v1/me/suggestions/{id}/dismiss`      | mark `dismissed`; idempotent                                             | `integration` |

`accept` re-validates through the same services as manual entry. A field suggestion whose
`baseHash` no longer matches the project's current value answers `409 SUGGESTION_STALE` and marks it
`superseded`, so an accept can never overwrite what the user changed after the suggestion was made.
The dashboard gets `openSuggestions` (a count). Not in the notifications bell (M5): a poll should
not create rows people must also clear.

### 6.6 Privacy

- Owner-only everywhere; no public read path; never in search or discovery.
- Only the user's **own** GitHub data, fetched with their own token; no other person's data, no
  email addresses stored (the university match stores the institution, not the address).
- Payloads are sanitized on write and again on accept; no tokens, no raw API bodies.
- Disconnect deletes open GitHub suggestions; account deletion cascades; resolved rows expire.
- Logs: counts and kinds only.

### 6.7 Cost

One PR, migration 0009, about 35 tests, roughly the size of (b). **Needs:** PR (b) merged (the diff
engine), PR (a)'s token source, `UNIVERSITY_DOMAINS` from Levon (one line for NPUA). No new infra
in the lazy mode.

## 7. Endpoints (all in `openapi.yaml`, `http/`, with an ownership test and a second-user 404)

| #   | Route                                                                    | PR  | Budget        | Notes                                              |
| --- | ------------------------------------------------------------------------ | --- | ------------- | -------------------------------------------------- |
| 1   | `GET /v1/me/integrations`                                                | a   | `integration` | GitHub and LinkedIn status; never a token or an id |
| 2   | `POST /v1/me/integrations/github/connect`                                | a   | `integration` | state `connected` or `link_required` + nonce       |
| 3   | `POST /v1/me/integrations/github/link`                                   | a   | `integration` | id token + nonce, §2.3                             |
| 4   | `DELETE /v1/me/integrations/github`                                      | a   | `integration` | idempotent                                         |
| 5   | `GET /v1/me/github/repos`                                                | b   | `integration` | paginated, rate limit surfaced                     |
| 6   | `POST /v1/me/github/import`                                              | b   | `import`      | batch ≤ 10                                         |
| 7   | `POST /v1/me/projects/{id}/github/sync`                                  | b   | `import`      | `?dryRun=true`                                     |
| 8   | `POST /v1/me/imports/linkedin/uploads`                                   | c   | `import`      | signed `PUT`                                       |
| 9   | `POST /v1/me/imports/linkedin/preview`                                   | c   | `import`      | deletes the object                                 |
| 10  | `POST /v1/me/imports/linkedin/confirm`                                   | c   | `import`      | one transaction                                    |
| 11  | `GET /v1/me/suggestions`, `…/refresh`, `…/{id}/accept`, `…/{id}/dismiss` | d   | as §6.5       |                                                    |

New budgets: `integration` (`RATE_LIMIT_INTEGRATION`, default 30/min); `import` stays at 5/min,
which is **tighter than the other routes by design**. Tracker 7.7 said `POST /v1/me/imports/linkedin`
takes the ZIP: that is replaced by items 8–10 because of the 4.5 MB body cap.

## 8. Configuration (all optional; unset = the feature answers `503 INTEGRATION_UNAVAILABLE`)

`AUTH0_M2M_CLIENT_ID`, `AUTH0_M2M_CLIENT_SECRET` (Secret Manager), `AUTH0_CLIENT_ID` (the
`Gradfolio` app, to check `aud` of the link id token), `GITHUB_API_BASE_URL`,
`GITHUB_TOKEN_CACHE_S`, `GITHUB_PAGE_MAX`, `GITHUB_IMPORT_MAX_BATCH`, `GITHUB_README_MAX_BYTES`,
`GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` (required by every GitHub route, D9 and §2.5),
`IMPORT_MAX_*` (§4.2),
`SUGGESTIONS_*`, `UNIVERSITY_DOMAINS`. A refine requires the M2M pair to be set together.
Production keeps booting with none of them, like `STORAGE_BUCKET`.

## 9. Migrations (additive, safe while the previous revision serves)

0008 (next free number is taken from `origin/main` on the day of the push; M8 may take one):

- `integrations`: `external_login VARCHAR(100) NULL`, `UNIQUE (integration_type, external_user_id)`
  (NULLs never clash), `CHECK (access_token IS NULL AND refresh_token IS NULL AND token_expires_at IS
NULL)`. The seed has no tokens; the previous revision never writes them.
- `integration_nonces` (hash PK, `user_id` FK cascade, `expires_at`).
- `project_github_imports` (§3.5).

0009 (PR d): `suggestions`, `integrations.poll_etag/polled_at/claims_hash`.

Each uses the runner's `skip-if` guard, so applying twice leaves nothing; `down` then `up` gives an
identical `db:schema` dump (checked in the PR); timed on the 3,000-project perf seed.

## 10. Security properties and their proof

| Property                                          | Proof (guard removed, test fails)                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No token in any response, log or error            | sentinel `gho_SENTINEL…` through fake Auth0 and fake GitHub, every flow including failures; grep over responses and captured logs                                               |
| Token never reaches MySQL                         | `CHECK` rejects an insert (3819); remove it, the test that inserts one passes, so the test is the guard                                                                         |
| `GithubAccessToken` prints nothing                | `JSON.stringify`, template string and `util.inspect` all `[redacted]`                                                                                                           |
| Link nonce is the caller's, single use, unexpired | second user's nonce 400; replay 400; expired 400; two concurrent links with one nonce: one wins (barrier)                                                                       |
| Link id token                                     | `alg: none`, HS256, wrong issuer, wrong audience, expired, old `iat`, `sub` not `github                                                                                         | `, nonce mismatch: each 400/401 |
| Account-in-use                                    | existing `users` row for the secondary sub → 409; second Gradfolio user with the same GitHub id → 409 (unique key removed: test fails)                                          |
| Import: no user URL fetched                       | strict body (extra `url` key 400); fake GitHub records every request path; only `/user/repos`, `/repositories/<int>`, `/repositories/<int>/readme`                              |
| Import: only own or push-permitted repos          | public repo of someone else → `skipped: not_owner`                                                                                                                              |
| Dedupe under race                                 | barrier: two concurrent imports of one repo: one project; remove `lockUser` → `1062`/`1213` surface; remove unique key → still one (lock), so each removal is shown separately  |
| Re-sync never overwrites an edit                  | table in §3.5, one test per row; `PATCH` committed during the sync's fetch survives (barrier)                                                                                   |
| README safety                                     | §3.4 corpus; remove the pre-pass → relative `href` and `<img>` tests fail                                                                                                       |
| ZIP guards                                        | corpus (§11); remove each limit, its fixture then parses or crashes                                                                                                             |
| ZIP leaves nothing                                | bucket listing empty after every corpus case; `fs` write functions spied: never called                                                                                          |
| Confirm atomic and deduped                        | injected failure on the 3rd section: nothing written; barrier: two concurrent confirms: one set of rows                                                                         |
| Ownership                                         | every write: second user gets 404 (sync, uploadId, suggestion accept/dismiss); `GET /me/integrations` never shows another user's row                                            |
| Disconnect revokes                                | fake GitHub records the grant delete; on its 5xx the row stays connected (`502`); its already-gone status still disconnects; remove the revoke-first order → the 5xx test fails |
| Rate limits                                       | 6th import call in a window is 429 with `Retry-After`; separate counters per route                                                                                              |
| GitHub error table                                | each class through the real fake server over HTTP (401, 403 with remaining 0, 429 + `retry-after`, 5xx, timeout)                                                                |

## 11. Final test matrix (the brief's, made concrete)

- Fresh clone: `npm ci`, build, verify, coverage ≥ 90%, integration.
- Second-user matrix: 404 on every write in §7.
- Token grep (above). Crypto test: **replaced** by "no token stored" unless D2 is overruled.
- ZIP corpus (synthetic, built in the test): bomb (declared and lying), traversal (`../`, absolute,
  backslash), non-CSV recognised name, oversized (declared and stored), empty ZIP, wrong columns,
  encrypted, too many entries, ratio, concurrent previews. Each a stable code; object deleted.
- Real runs (queue rows): GitHub login user and an email-signup user (if the spike allows linking),
  import 2 repos as drafts, edit one and publish, re-sync, edits survive, disconnect and the card
  says what happened; a real LinkedIn export previews, confirm adds only the selected items, the
  second time none; production `/readyz` 200.
- Run first, no login needed: everything against fake Auth0 and fake GitHub over real HTTP.

## 12. PR breakdown and the queue

| PR           | Contents                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| plan (this)  | `docs/m7-plan.md`                                                                                                                                                                              |
| (a)          | OpenAPI contract for 1–10, config, migration 0008, token source + M2M client, `GithubClient`, connect/link/disconnect, `GET /me/integrations`, `verified` computation, account-deletion revoke |
| (b)          | repos list, import, re-sync, README pipeline, `githubStars` test, seed update                                                                                                                  |
| (c)          | LinkedIn uploads, preview, confirm, header script, synthetic fixtures; **after 7.6 headers are verified**                                                                                      |
| (d)          | suggestions (§6)                                                                                                                                                                               |
| verification | `docs/m7-verification.md`                                                                                                                                                                      |

### Queue rows (proposed text; the lead edits `manual-testing.md`)

**M7-T1 (wording update).** Add: "Note your LinkedIn interface language in the folder name or a
text file (en / ru / am): column names may be localised. Do not unzip. The agent runs
`scripts/linkedin-export-headers.mjs` on each ZIP; it prints four file names, their header lines and
an extension count, nothing else."

**M7-T2 (replaces "GitHub app registration").** _Auth0 side, 20 minutes, Levon in the dashboard._

1. Authentication → Social → **GitHub**: confirm it uses **your own GitHub OAuth App** (Client ID
   filled), callback `https://<tenant domain>/login/callback`. If it uses Auth0's developer keys,
   register an OAuth App at GitHub → Settings → Developer settings → OAuth Apps and paste its
   client id and secret **into the Auth0 connection** (not into chat).
2. Same page, Attributes: tick _Email address_ and _Read user_. **Do not tick `repo` or any
   private-repository permission** (D6). Make sure the connection is enabled for `Gradfolio`.
3. Applications → Create Application → name `Gradfolio API (IdP tokens)` → _Machine to Machine_ →
   authorize **Auth0 Management API** → scopes `read:user_idp_tokens` and `update:users` only.
   Do **not** authorize it for any other API, and do not reuse `Gradfolio`.
4. Copy its Client ID into the m7 `.env` as `AUTH0_M2M_CLIENT_ID`; put the Client Secret into Secret
   Manager yourself: `pbpaste | gcloud secrets create gradfolio-auth0-m2m-secret --data-file=-`
   (with `CLOUDSDK_CONFIG` as in deploy.md), then `pbcopy </dev/null`. Never paste it in chat.
5. APIs → Auth0 Management API → Settings: read the **token lifetime** and tell the agent the number.
6. Applications → `Gradfolio` → Allowed Callback URLs: add `http://localhost:3000/auth/github-link`
   (and the production URL later); the FE agent names the exact path.
7. Required (D9, §2.5: disconnect revokes at GitHub): put the OAuth App's client secret into
   `gradfolio-github-client-secret` the same way, and its client id into `.env` as
   `GITHUB_CLIENT_ID`.
   Then say "m7-t2 done". The agent runs the §2.1 spike with a throwaway test user.

**M7-T3 (rewritten).** _Not needed under D1 = A with D2 = no cache._ Reinstated only if D2 is
overruled: secret `gradfolio-integration-key` as `k1:<base64 of 32 random bytes>`, created without
printing it.

**M7-T7 (new).** Bucket lifecycle for `imports/`: `gcloud storage buckets update
gs://gradfolio-files-1058577031182 --lifecycle-file=docker/gcs-lifecycle.json` (age 1 day, prefix
`imports/` only; the file arrives with PR (c)). Cost: $0.

**M7-T8 (new).** After PR (a) merges: wire the Cloud Run service with `--update-secrets
AUTH0_M2M_CLIENT_SECRET=gradfolio-auth0-m2m-secret:latest` and `--update-env-vars
AUTH0_M2M_CLIENT_ID=…,AUTH0_CLIENT_ID=…`, and grant `secretAccessor` to `gradfolio-api-run`. A new
secret is about $0.06 per month, inside the free tier.

**M7-T9 (new, PR d).** Give the agent the NPUA mail domain list for `UNIVERSITY_DOMAINS`.

## 13. Changes needed in the frontend repo (listed, not made)

Integrations page on `/v1/me/integrations`; connect: call `connect`, and on `link_required` start
the Auth0 authorize in a transaction **separate** from the session with `connection=github` and the
nonce, forward the callback's `id_token` to `link`, never store it, never render it; repo picker
(paginated, shows `rateLimit`); import result and draft review; per-project "Re-sync" with the
per-field outcome and `dryRun`; the LinkedIn wizard `PUT`s the ZIP **from the browser** to the signed
URL (never through a Next.js route) then calls preview and confirm; suggestions inbox and a count on
the dashboard; GitHub source badge from `source`. All calls from the server side (Q11).

## 14. Other integrations worth considering (recommendation only; not for M7)

| Integration            | What it gives a student portfolio                                 | Auth and API                                                                                                                                           | Feasibility                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ORCID**              | verified identity; education, employment, publications (**docs**) | Public API, free; OAuth sign-in, `/authenticate` scope; client registration needs an ORCID account (**docs**)                                          | **High.** Best fit for students doing research. Open API, no approval. Low coverage among undergrads.                                                                                    |
| **GitLab**             | repos like GitHub                                                 | OAuth 2.0 with PKCE, 2 h tokens with refresh, apps registered in user settings (**docs**)                                                              | **High**, same shape as the GitHub client; not an Auth0 built-in social, so a custom OAuth2 connection or our own flow.                                                                  |
| **Credly (badges)**    | verified certifications                                           | Official API is per issuing **organization** (Basic auth with an org token, **docs**); public badge pages and a public search exist but are unofficial | **Medium-low.** Accept only a Credly profile URL on a fixed host and read public pages; fragile. Prefer asking for the badge URL as a certification `credentialUrl` (already supported). |
| **Hugging Face**       | models and datasets for ML students                               | "Sign in with HF" OAuth and a public Hub API (**from memory, unverified**)                                                                             | **Medium.** Cheap, fits a technical cohort; verify before committing.                                                                                                                    |
| **Behance / Dribbble** | design portfolios                                                 | Behance's API is not accepting new apps and its developer page is gone as of 2024 (**docs/community**); Dribbble v2 OAuth needs approval (unverified)  | **Low.** Not now.                                                                                                                                                                        |
| Google Scholar         | citations                                                         | No official API; scraping is against its terms                                                                                                         | **No.**                                                                                                                                                                                  |

Recommendation: ORCID first (cleanest, verifiable), GitLab second (reuses §3's client).

## 15. Out of scope

Private repositories (D6), webhooks, a scheduler, unlinking at Auth0, a public LinkedIn badge,
`experience.add` from GitHub text (listed in §6.2 as a choice), CSV export (if one is ever added,
cell values starting with `=`, `+`, `-`, `@` must be escaped there; imported values are stored
verbatim today), bulk re-sync of all projects.

## 16. Not verified in this plan

- Anything against the Auth0 tenant: linking on Free, Token Vault on Free, the M2M token lifetime,
  own-keys vs developer keys, `connection_scope`, whether `identities[].access_token` is returned
  for this connection (§2.1 answers all of them).
- The Management API's real behaviour under 2 rps with a retry (only the documented limit).
- Any real LinkedIn export (names, localisation, dates, field of study): §4.1.
- GitHub rate-limit and error responses beyond `200`/`304` (they come from a fake over HTTP, not the
  real service).
- Hugging Face's and Dribbble's current API terms.
- The frontend's sanitizer config (only needed for D3 option 2).
