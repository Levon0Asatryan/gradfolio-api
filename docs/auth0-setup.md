# Auth0 setup checklist (tracker 2.1–2.4)

Levon runs this in the Auth0 dashboard; the design behind each step is in
[m2-plan.md](m2-plan.md). Tick each box. Where the dashboard differs from what is
written here (Auth0 moves things), do the equivalent and note the difference in §9.

**Secrets never go into a repository, a PR, a chat or a log.** Client secrets stay in
Auth0 and Vercel; the test tokens (§7) go only into the gitignored `.env` of the API
worktree.

**Progress:** §10 records what the tenant actually held on 2026-10-02, and the steps
that were still missing. Check it before re-running anything above.

Values used below (change them if you prefer, then use yours everywhere):

| Name                 | Value                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| Tenant domain        | the existing `dev-….auth0.com` (Settings → General, or the app's "Domain")  |
| API identifier       | `https://api.gradfolio.app` (the **audience**; it is a name, never fetched) |
| Claim namespace      | `https://gradfolio.app/`                                                    |
| Frontend, local      | `http://localhost:3000`                                                     |
| Frontend, production | the Vercel production URL (e.g. `https://gradfolio.vercel.app`)             |
| Frontend, preview    | the branch alias of the branch under test (`https://<VERCEL_BRANCH_URL>`)   |

## 1. Tenant

- [ ] Note the tenant domain. The API's issuer is `https://<tenant domain>/`, **with**
      the trailing slash.
- [ ] Tenant Settings → Advanced: leave defaults. (A production tenant comes in M9, §8.)

## 2. The API (2.1)

Applications → APIs → **Create API**:

- [ ] Name: `Gradfolio API`
- [ ] Identifier: `https://api.gradfolio.app` (cannot be changed later)
- [ ] JSON Web Token (JWT) Profile: **Auth0**
- [ ] JSON Web Token (JWT) Signing Algorithm: **RS256** (cannot be changed later; the API
      accepts RS256 only)

Then on the API's **Settings** tab:

- [ ] Maximum Access Token Lifetime: **3600** seconds (1 hour; the default is 86400).
      Shorter limits a stolen token, and refresh tokens (§3) renew it.
- [ ] Allow Skipping User Consent: **on** (first-party app). On `localhost` Auth0 still
      shows a consent screen; accept it.
- [ ] Allow Offline Access: **on** (the frontend needs a refresh token for this audience).
- [ ] Enable RBAC: **off** (no permissions in v1).

On the API's **Application Access** tab (if the dashboard shows it):

- [ ] User-delegated access policy: **Per-app authorization**.
- [ ] Edit → the Next.js application → **Grant Access** (no permissions to select).
- [ ] Client (machine-to-machine) access: none.

## 3. The Next.js application (2.1)

Applications → Applications → the existing Next.js app (type **Regular Web
Application**):

- [ ] Settings → Advanced Settings → Grant Types: **Authorization Code** and **Refresh
      Token** on; Implicit and Password off.
- [ ] Settings → Refresh Token Rotation: **off** (the SDK's advice for server-side apps:
      concurrent refreshes otherwise race).
- [ ] Settings → Refresh Token Expiration: Absolute Expiration **on**, 2592000 s
      (30 days); Inactivity Expiration **on**, 604800 s (7 days).
- [ ] The **APIs** tab: `Gradfolio API` authorized (it is, after §2's grant).

## 4. Callback and logout URLs (2.2)

The v4 SDK's routes are `/auth/callback` and, after logout, the app's base URL.
Same application → Settings → Application URIs:

- [ ] Allowed Callback URLs:
      `http://localhost:3000/auth/callback, https://<production host>/auth/callback`
- [ ] Allowed Logout URLs: `http://localhost:3000, https://<production host>`
- [ ] Allowed Web Origins: leave empty (the browser never talks to Auth0 from script).
- [ ] For each preview you test on (M2 exit criterion): add
      `https://<branch alias>/auth/callback` and `https://<branch alias>`. Remove them when
      the branch is gone. **Never** `https://*.vercel.app/…`: anyone can deploy to
      `vercel.app`.

## 5. Connections (2.2)

Authentication → Database → **Username-Password-Authentication**:

- [ ] Applications tab: enabled for the Next.js app.
- [ ] Settings: "Requires Username" off; Password Policy at least **Good**.
- [ ] Branding → Email Templates → **Verification Email**: enabled. (Auth0's built-in
      email provider is for testing and rate-limited; fine for coursework. A real
      provider is an M9 decision.)

Authentication → Social:

- [ ] **Google**: create; attributes: email, profile. Development keys are acceptable on
      this tenant (Auth0 shows a warning); production needs your own Google OAuth
      client (M9, 9.4). Enable for the app.
- [ ] **GitHub**: create a GitHub OAuth App (GitHub → Settings → Developer settings →
      OAuth Apps): Homepage `http://localhost:3000`, callback
      `https://<tenant domain>/login/callback`. Paste its client id and secret into the
      Auth0 GitHub connection; attributes: **Email address**. Enable for the app.
      (Repository access is M7, not here.)
- [ ] **LinkedIn**: create a LinkedIn app (linkedin.com/developers), add the product
      **Sign In with LinkedIn using OpenID Connect**, redirect URL
      `https://<tenant domain>/login/callback`. In Auth0's LinkedIn connection use the
      newest strategy version, attributes **profile** and **email**, paste the client id
      and secret. Enable for the app. It returns name, photo and email; **no headline**
      (m2-plan §8.2).

Test accounts:

- [ ] A database user with a **verified** email, and a second one left **unverified**
      (the `verified` flag is tested both ways).
- [ ] Your own Google, GitHub and LinkedIn accounts, as far as you have them.

## 6. The Action that puts profile claims into the access token (2.4)

Actions → Library → **Create Action** → Build from scratch: name
`Gradfolio access-token claims`, trigger **Login / Post Login**, the newest Node
runtime offered. Code:

```js
/**
 * Adds namespaced profile claims to access tokens for the Gradfolio API only.
 * The API reads them to create the user's row and keep `verified` current
 * (gradfolio-api docs/m2-plan.md §3.4). Custom claims on an access token for a
 * custom API must be namespaced.
 */
exports.onExecutePostLogin = async (event, api) => {
  const AUDIENCE = 'https://api.gradfolio.app';
  const NS = 'https://gradfolio.app/';
  if (event.resource_server?.identifier !== AUDIENCE) return;

  const u = event.user;
  api.accessToken.setCustomClaim(`${NS}email_verified`, u.email_verified === true);
  if (typeof u.email === 'string') api.accessToken.setCustomClaim(`${NS}email`, u.email);
  if (typeof u.name === 'string') api.accessToken.setCustomClaim(`${NS}name`, u.name);
  if (typeof u.picture === 'string') api.accessToken.setCustomClaim(`${NS}picture`, u.picture);
  if (typeof u.headline === 'string') api.accessToken.setCustomClaim(`${NS}headline`, u.headline);
  const providers = (u.identities ?? [])
    .map((i) => i.provider)
    .filter((p) => typeof p === 'string');
  api.accessToken.setCustomClaim(`${NS}identities`, providers);
};
```

- [ ] **Deploy** the Action.
- [ ] Actions → Triggers → **post-login**: drag it into the flow → **Apply**.

## 7. A test user access token (for Phase 3)

The API worktree cannot finish without one real token per connection you can test.
Tokens live 1 hour, so do this right before you say "ready".

1. [ ] In the `gradfolio` checkout, `.env.local` (not committed) gets
       `AUTH0_AUDIENCE=https://api.gradfolio.app` next to the existing Auth0 values.
       Nothing else changes in that repo.
2. [ ] `npm run dev` there; open `http://localhost:3000/auth/login`, sign in with one
       connection (Universal Login offers them all).
3. [ ] Open `http://localhost:3000/auth/access-token`. It returns
       `{"token":"eyJ…","scope":"…","expires_at":…}`. (The frontend session will turn
       this route off later; it is fine locally now.)
4. [ ] Copy the `token` value into
       `/Users/levon/Dev/university/gradfolio-repos/gradfolio-api-m2/.env`:

       ```sh
       AUTH0_ISSUER_BASE_URL=https://<tenant domain>/
       AUTH0_AUDIENCE=https://api.gradfolio.app
       M2_TEST_TOKEN_DATABASE=eyJ…
       M2_TEST_TOKEN_DATABASE_UNVERIFIED=eyJ…
       M2_TEST_TOKEN_GOOGLE=eyJ…
       M2_TEST_TOKEN_GITHUB=eyJ…
       M2_TEST_TOKEN_LINKEDIN=eyJ…
       ```

       Log out (`http://localhost:3000/auth/logout`) between connections. Leave out the
       ones you cannot test.

5. [ ] Do **not** paste a token into a website (jwt.io included) or into the chat. To
       check one locally without printing it:

       ```sh
       node -e 'const p=JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url"));console.log(p.iss,p.aud,Object.keys(p))' "$M2_TEST_TOKEN_GOOGLE"
       ```

       Expected: your issuer, an `aud` array containing `https://api.gradfolio.app`, and
       keys including `https://gradfolio.app/email_verified`.

## 8. Decisions for you (2.3)

- [ ] **Production tenant.** Recommended: keep the `dev-…` tenant for local and previews
      now; create a separate production tenant in M9 (9.4), with its own Google keys
      and callback URLs. Separate tenants mean a preview's tokens can never be used
      against production, and test users never appear in production. Cost: the
      checklist above runs once more in M9.
- [ ] **Account linking.** Recommended: none in v1. Each login method is its own
      account. Automatic linking by email hands an account to whoever controls an
      unverified email on another provider.

## 9. What to send back

- The tenant domain (issuer) and the audience. Neither is secret.
- Which connections have a token in `.env`, and which you could not test.
- Your answers to §8.
- Anything in the dashboard that did not match this checklist.

## 10. Tenant state on 2026-10-02, and the remaining steps

The orchestrator read this tenant (`dev-wkthnyn8b8mjn5ae`) through the Auth0 MCP on
2026-10-02, after the setup session's changes at 17:12–17:16 UTC.

**Limits of that read.** The MCP cannot read connections, Action trigger bindings,
refresh-token rotation, or Branding. Those rows say "check in the dashboard".

### What is already in place

| Step                                      | State                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| §2 API `https://api.gradfolio.app`        | Done: RS256, access-token lifetime 3600 s, offline access on, consent skipped for first-party apps, RBAC off   |
| §3 App `Gradfolio` (`AlVr5…`): grants     | Partly: Authorization Code + Refresh Token on, but **Client Credentials is also on** (10.2)                    |
| §4 Callback and logout URLs               | Done for localhost and `https://gradfolio-navy.vercel.app`; no preview URLs yet (add them per §4 when testing) |
| §6 Action `Gradfolio access-token claims` | Created, built and deployed (node22, version 1). **Its trigger binding cannot be read: check it (10.1)**       |
| §7 Test tokens                            | `gradfolio-api-m2/.env` has 5 token entries (17:16 UTC). Tokens live 1 h; refresh them before Phase 3 runs     |

### Missing or different from this checklist

- [ ] **10.1 Put the Action in the Login flow.** Actions → Triggers → **post-login** →
      drag `Gradfolio access-token claims` in → **Apply**. - The MCP can create and deploy an Action, but it cannot bind it to a trigger. - An unbound Action never runs, so access tokens carry **none** of the
      `https://gradfolio.app/` claims, and every user stays unverified. - Check it: decode a fresh test token (§7 step 5) and look for
      `https://gradfolio.app/email_verified`.
- [ ] **10.2 Turn off Client Credentials** on `Gradfolio`: Settings → Advanced →
      Grant Types. Keep only Authorization Code + Refresh Token. The app never acts as
      a machine-to-machine client, and an unused grant only widens what a leaked secret
      allows.
- [ ] **10.3 Only `Gradfolio` may get API tokens for users.** The API's user access
      policy is **`allow_all`**: every application in the tenant can request a user
      token for `https://api.gradfolio.app`. That includes the legacy app in 10.4,
      which still has the Implicit grant. - Set the API's Application Access → user-delegated access to **Per-app
      authorization**. - Grant only `Gradfolio` (§2, last part).
- [ ] **10.4 Remove the legacy application `gradfolio` (`R6OR…`, "Vercel
      Application").** - Auth0's Vercel integration created it on 2025-12-08. It uses the SDK v3
      routes (`/api/auth/callback`), is not OIDC-conformant, and has the
      **Implicit** grant on. - The live site signs in with `Gradfolio` (`AlVr5…`, seen in the login redirect
      on 2026-09-28). - Before deleting, confirm Vercel's `AUTH0_CLIENT_ID` (Production and Preview)
      is `AlVr5…`. If the Vercel–Auth0 integration is installed, uninstall it, so it
      stops managing variables. - Then delete `gradfolio`. Also delete `Default App`, which is unused.
- [ ] **10.5 Clear the origin lists** on `Gradfolio`: - Allowed Web Origins and Allowed Origins (CORS) currently list localhost and the
      Vercel URL. §4 says leave them empty, because the browser never talks to
      Auth0 from script with the server-side SDK. - Also set Cross-Origin Authentication **off**. - If login breaks after this, put them back and note it under §9.
- [ ] **10.6 Check the login page.** `Gradfolio` has `custom_login_page_on: true`. - In Branding → Universal Login, confirm the **New** Universal Login experience
      is in use, and that no customized classic HTML page is overriding it. - Otherwise the social buttons from §5 may not appear.
- [ ] **10.7 Check refresh tokens** (the MCP shows them as redacted). - `Gradfolio` → Settings → Refresh Token Rotation **off**. - Absolute Expiration 30 days; Inactivity Expiration 7 days (§3).
- [ ] **10.8 Check connections** (the MCP cannot read them; §5): - database with email verification on, Google, GitHub and LinkedIn, each
      **enabled for `Gradfolio`**; - the two database test users, one verified and one unverified. - Record which ones exist under §9.
- [ ] **10.9 Vercel environment** (tracker 2.8; the frontend session also needs this): - Production and Preview get `AUTH0_AUDIENCE=https://api.gradfolio.app`, and
      `AUTH0_SCOPE` including `offline_access`. Today the production login redirect
      carries no `audience`. - Previews additionally get their own `APP_BASE_URL`. - Redeploy, then confirm `/auth/login`'s redirect includes `audience=`.
- [ ] **10.10 Leave the ID-token lifetime as is** (36000 s on `Gradfolio`). It only
      governs the SDK session cookie's ID token, and the API never accepts ID tokens.
      Noted so nobody "fixes" it while chasing the access-token lifetime.
