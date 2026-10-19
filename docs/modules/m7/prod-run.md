# M7-T4: the real GitHub run, against production

Written 2026-10-15. Runs **against production**, so no token, secret or `.env` lands on any
machine: Levon signs in once, headed, in the frontend; the API's own Cloud Run log is the
instrument. Nothing here asks for a password, a token or a client secret.

It starts when FE #101 (the integrations page) is merged and deployed. It answers the open
questions of [plan.md](plan.md) §2.1 and §16 from how production behaves, and fills
`verification.md` (GitHub half).

## 0. Who does what

| Who            | Does                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Levon          | One headed login in the frontend (FE agent's `login.mjs`: he types the credentials himself). Clicks the steps in §3.       |
| FE agent       | Drives the integrations page for Levon's session and writes down what the page showed (status, `available`, errors).       |
| API agent (me) | Runs `scripts/m7-prod-observe.sh` (read only) before, during and after, and writes the findings into the verification doc. |

Two accounts, because the answers differ by how a student signed up:

- **G:** signs in with GitHub (Levon's own GitHub account). `sub` is `github|<id>`: no link needed.
- **E:** signs in with email or Google (an existing test account). Needs the link flow (§3, step 6).

## 1. The instrument

```sh
cd gradfolio-api            # any checkout of main; the script needs no env file
sh scripts/m7-prod-observe.sh preflight        # once, before
sh scripts/m7-prod-observe.sh logs 30          # the GitHub lines of the last 30 minutes
sh scripts/m7-prod-observe.sh requests 30      # method, path, status, ms of the M7 routes
sh scripts/m7-prod-observe.sh verdict 120      # counts and the §2.1 answers
```

- It sets `CLOUDSDK_CONFIG=/Users/levon/Dev/university/.sandbox/gcloud` and **refuses** to run
  against any other gcloud configuration.
- It reads only: `gcloud run services describe` (names of env vars, never values),
  `gcloud logging read` with each field projected by name (no whole entry is ever printed), and
  GETs that carry no credential.
- Log lines have static messages and fields (`github connected`, `github linked`,
  `github disconnected`, `github grant revoked` with `result`, `github link refused by auth0` with
  `status`, `request rejected` with `code`, `path` and `cause`). A token, a nonce and the id token
  are redacted or never logged; an integration test asserts it for every flow
  (`github-connect.int.test.ts`, "no token in any response or log").
- A user is a UUID in these lines (`userId`). That is not a secret and not an email.

## 2. Preflight (before Levon signs in)

`preflight` must show:

| Check                                  | Expected                                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| latest ready revision                  | the revision that serves (00041 or later)                       |
| the five settings                      | `present` for each of them (names only)                         |
| `/readyz`                              | 200                                                             |
| the seven M7 routes with no credential | 401 each (deployed, and nothing is open to an anonymous caller) |

If a setting is `MISSING`, every GitHub route answers 503 `INTEGRATION_UNAVAILABLE` and the run
stops there: that is the first answer.

## 3. The run

Each step says what Levon does, what the page should show, and which log line proves it. The
agent runs `logs 10` after each step and writes the line (not its meaning only) into the record.

| #   | Account | Levon / the page                                                                                                                    | Expect                                                                                                          | Log evidence                                                                                                                         | Answers                                                                                        |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1   | G       | Open the integrations page                                                                                                          | GitHub "available", not connected; LinkedIn connected only if signed in with it                                 | `request completed` `GET /v1/me/integrations` 200                                                                                    | **`available` is true in production**                                                          |
| 2   | G       | Connect GitHub                                                                                                                      | Connected, shows his GitHub login at once (no second consent)                                                   | `github connected`; request 200 on `…/github/connect`                                                                                | **The IdP token is returned with own keys**; M2M scope works; token accepted by GitHub         |
| 3   | G       | Repository picker                                                                                                                   | Only his **public** repositories; paging works; remaining rate limit shown                                      | request 200 on `GET /v1/me/github/repos`                                                                                             | Real list shape and `Link` paging; no private repo appears with `read:user`+`user:email`       |
| 4   | G       | Import two repositories                                                                                                             | Two drafts; README is the description with no images and relative links on github.com                           | request 200 on `POST …/github/import`                                                                                                | Real repository and README answers through the pipeline                                        |
| 5   | G       | Edit one draft's title and publish it; change nothing on the other                                                                  | Published project shows the GitHub badge and the stars on the dashboard                                         | `PATCH /v1/projects/…` 200 (not an M7 route; shown for order)                                                                        | `githubStars` and `source` end to end                                                          |
| 6   | G       | Re-sync both (dry run first, then real)                                                                                             | Edited title **kept**; unedited fields **unchanged** (or updated if the repo moved)                             | request 200 on `POST …/github/sync` ×4                                                                                               | Edits survive; stars/forks refresh silently                                                    |
| 7   | E       | Open the page, connect GitHub                                                                                                       | "Link required", GitHub consent, back on the page, **connected**                                                | `github linked` (or `github link refused by auth0` with `status`)                                                                    | **Account linking works on this tenant (Free plan) for an email-signup user**                  |
| 8   | E       | Repository picker, import one, disconnect                                                                                           | As above; disconnect says not connected                                                                         | `github grant revoked` with `result`                                                                                                 | Linked identity gives the same token path                                                      |
| 9   | G       | Disconnect                                                                                                                          | Not connected; `verified` falls back to the email                                                               | `github grant revoked` `result: revoked`; `github disconnected`                                                                      | **Disconnect revokes at GitHub** (also confirm in step 10)                                     |
| 10  | G       | github.com → Settings → Applications → Authorized OAuth Apps                                                                        | Gradfolio is **not** listed any more                                                                            | (GitHub's own page)                                                                                                                  | The grant is really gone                                                                       |
| 11  | G       | Connect again **without** signing in to GitHub again                                                                                | 409 "sign in with GitHub again" (`GITHUB_NOT_LINKED`) once the 5-minute cache has lapsed                        | `request rejected` `GITHUB_NOT_LINKED`; `cause: github not linked: github 401`                                                       | **Auth0 returns the stale, revoked token** (plan §2.1 step 5)                                  |
| 12  | G       | Sign out, sign in with GitHub, connect                                                                                              | Connected again                                                                                                 | `github connected`                                                                                                                   | A fresh login replaces the token; reconnect works                                              |
| 13  | G       | While connected (after step 12), revoke the app by hand at github.com → Settings → Applications, then click Disconnect in Gradfolio | Not connected (GitHub's status for a grant already gone is accepted), or a 502 that says GitHub did not confirm | `github grant revoked` `result: already_gone`, **or** `request rejected` `GITHUB_REVOKE_FAILED` with `cause … DELETE grant <status>` | **The status GitHub gives for a grant already gone** (`GRANT_ALREADY_GONE` is 422, unverified) |
| 14  | G, E    | Delete the imported draft projects; leave GitHub disconnected                                                                       | Clean                                                                                                           | —                                                                                                                                    | Cleanup                                                                                        |

Notes for the run:

- Do steps 11 to 13 in this order and not earlier: they spend the grant.
- Step 13 is the only way to see GitHub's real "already gone" status: the API revokes only a
  connected row, so the token must be dead at GitHub while the row is still connected. If GitHub's
  status is not in `GRANT_ALREADY_GONE`, the disconnect is a 502 and the row stays connected: sign
  in with GitHub again and disconnect (the new token is revoked normally), then record the status.
- Do not repeat clicks to "force" a rate limit. Production traffic is a real user's; §5 explains
  what stays unobserved.

## 4. Reading the answers

`verdict 120` after the run prints counts. How each line maps to a question of §2.1:

| Question                                           | Where it shows                                                                                                  | Reading                                                                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Own keys or Auth0 dev keys; is the IdP token given | `github connected` ≥ 1, no `github identity without a token`                                                    | token present and accepted by GitHub: **own keys, scope `read:user_idp_tokens` works**                                                                                                        |
| …if not                                            | `request rejected` `INTEGRATION_UNAVAILABLE`, `cause: integration unavailable: github identity without a token` | identity exists but Auth0 withheld the token: M2M lacks the scope, or the connection uses dev keys                                                                                            |
| Is the M2M app authorized                          | `cause: integration unavailable: m2m token <status>` or `management api 401/403`                                | the secret, audience or grant is wrong                                                                                                                                                        |
| Can an email-signup user link (Free plan)          | `github linked` vs `github link refused by auth0` with `status`                                                 | linked: linking works here. refused: the status says why (403 plan, 409 already linked)                                                                                                       |
| Management API rate limit                          | `cause: … management api 429`, or `Retry-After` on a 503                                                        | 0 hits means **not observed**, not "no limit"; the limit is documented as 2 requests/s                                                                                                        |
| Does disconnect revoke                             | `github grant revoked` with `result: revoked` and step 10                                                       | yes when both agree                                                                                                                                                                           |
| Status of an already-gone grant                    | step 13                                                                                                         | update `GRANT_ALREADY_GONE` in `github-client.ts` to what was seen, with a test (seen on 2026-10-19: `404` for a refused token; handled by the token check in `deleteGrant`, not by the list) |
| Stale token after a revoke                         | step 11                                                                                                         | 409 `GITHUB_NOT_LINKED` confirms Auth0 does not refresh or clear it                                                                                                                           |

## 5. What this run cannot answer

- **M2M token lifetime** (Auth0 → APIs → Auth0 Management API → Settings). Levon reads the number
  from the dashboard (M7-T2 step 5); nothing in the API's log carries it.
- **Token Vault on Free** (plan §2.1 step 4): not exercised; A1 is what runs. The answer matters
  only if linking is refused in step 7.
- **A real Management API 429.** At tens of users and a 5-minute cache the API never gets near 2
  requests per second, so the run will show zero. That is "not observed".
- **GitHub's private-repository behaviour**: D6 requests none, so none can be seen.
- **A different Auth0 tenant** (production tenant, M9): this is the `dev-…` tenant.

## 6. Safety

- Read only: the script cannot change a revision, a secret or a log sink.
- No secret is printed: env var **values**, headers and bodies are not part of any projection, and
  a test proves the application never writes a token to its log.
- If a step goes wrong (a stuck marker, a connected row with a dead token), the state is
  repairable from the page: a repeated disconnect, or a fresh GitHub login then connect (plan
  §2.3). Nothing needs a database edit.
- The two test accounts' projects are deleted in step 14; the OAuth grant is revoked in step 9.
  Nothing from the run persists except log lines (30 days) and the `integrations` rows, which
  end `not_connected`.
