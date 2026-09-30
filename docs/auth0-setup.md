# Auth0 setup checklist (tracker 2.1–2.4)

Levon runs this in the Auth0 dashboard; the design behind each step is in
[m2-plan.md](m2-plan.md). Tick each box. Where the dashboard differs from what is
written here (Auth0 moves things), do the equivalent and note the difference in §9.

**Secrets never go into a repository, a PR, a chat or a log.** Client secrets stay in
Auth0 and Vercel; the test tokens (§7) go only into the gitignored `.env` of the API
worktree.

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
