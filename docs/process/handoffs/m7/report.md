# M7 lead report: GitHub and LinkedIn integrations (interim, 2026-10-15)

**M7 is not finished.** GitHub connect works on production. The GitHub import screen,
suggestions, profile data from integrations and all LinkedIn work are not built. Written to
this file because messages to `gradfolio-repos-d8` have been held before.

## Task

M7 tasks 7.1–7.12 across `gradfolio-api` and `gradfolio`.

## Status

In progress. Exit criteria from the tracker, checked against production:

| Exit criterion                                            | State                                                                                                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Link GitHub                                               | **works** (user confirmed the connect completes, 2026-10-15)                                                                                                                     |
| Import 2 repos as drafts                                  | API live (#79); **no screen yet** (FE PR 3)                                                                                                                                      |
| Edit one and publish, re-sync, edits survive              | API live and tested locally; **not run on production**, no screen                                                                                                                |
| Disconnect deletes the tokens                             | tokens are never stored (D2); disconnect revokes the grant: seen once in the log (`github grant revoked`, during account deletion); **the Disconnect button itself not yet run** |
| Real LinkedIn export previews, confirm adds only selected | **not started**: waiting on the three exports (M7-T1)                                                                                                                            |
| Malformed/oversized ZIP rejected with a stable code       | **not started** (API PR c)                                                                                                                                                       |

## Requirement added by Levon (2026-10-15)

**An integration must bring data, not only a connection.** Connecting GitHub today only links
the account. M7 is not done until a connected integration also fills the product:

- GitHub: repositories become draft projects (API done, screen missing) **and** profile data
  (bio, avatar, company, location, and later changes) is offered as suggestions the user
  accepts or dismisses, never silent overwrites. This is **not in the plan yet**; it goes into
  API PR (d) and the FE suggestions inbox.
- LinkedIn: positions, education, skills and certifications from the export (PR c, FE PR 4),
  plus name and photo pre-fill from the sign-in identity (7.10).
- Both: later changes upstream become suggestions (PR d).

## Pull requests (all merged by the `Levon0Asatryan` account; the lead merged only #73 and #79)

### API (`gradfolio-api`)

| PR  | What                                                                                     | Review of the merged head                                                                                   | Merged                     |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------- |
| #72 | plan `docs/m7-plan.md`                                                                   | Codex and Copilot on earlier heads                                                                          | Levon's account            |
| #73 | (a) GitHub connect through Auth0, link, disconnect, `verified`, migration 0008, contract | Codex, no findings on `6328bec` after 4 rounds (13 findings fixed or answered)                              | **lead**, `19876a2`        |
| #79 | (b) repos list, import, re-sync, README safety                                           | Codex, no findings on `be5102d`; one thread (locking read) pushed back with a run (deadlock 1213), accepted | **lead**, `fbfdbaf`        |
| #80 | `source` on every project summary shape                                                  | Codex, no findings on `317083d`                                                                             | Levon's account, `2b8c5c1` |
| #81 | docs: production run checklist and read-only observer                                    | Codex not yet reviewed when merged                                                                          | Levon's account            |

### FE (`gradfolio`)

| PR   | What                                                                                         | Review of the merged head                                                                              | Merged          |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------- |
| #89  | plan                                                                                         | Copilot only (quota), no Codex                                                                         | Levon's account |
| #90  | plan addendum (suggestions inbox, GitHub through Auth0)                                      | Codex and Copilot on earlier heads                                                                     | Levon's account |
| #91  | `TruncatedText` tooltip                                                                      | Codex on earlier heads                                                                                 | Levon's account |
| #101 | integrations page, GitHub connect/disconnect                                                 | Codex found 2 P2 on `4b4802b`; **merged with both open**                                               | Levon's account |
| #104 | #101 review fixes, search suggestion text                                                    | Codex review landed after merge                                                                        | Levon's account |
| #106 | connect refused production's `AUTH0_DOMAIN` (scheme included); callback logs the Auth0 error | pending at merge                                                                                       | Levon's account |
| #107 | `AUTH0_GITHUB_CONNECTION` (connection Name)                                                  | **merged with Codex's P2 open** (name limit 64 vs Auth0's 128; not fixed on the merged head `6c8ad72`) | Levon's account |

## What changed

- **API:** GitHub connects through Auth0's identity-provider token (no token stored, D2),
  with account linking, a link nonce bound to the user, revocation at GitHub on disconnect and
  on account deletion, `verified` = email verified OR GitHub linked, repo listing and import as
  drafts (dedupe by `github_repo_id` under the user lock), re-sync that never overwrites a field
  the user edited, README rewritten through an allow-list with images dropped (D3 option 1),
  `source` on project shapes, `githubStars` now has data once a GitHub project is published.
- **FE:** `/integrations` on the API with an honest error panel, connect as a secondary Auth0
  sign-in (never replaces the session), disconnect with confirmation and honest wording for an
  unconfirmed revocation, the onboarding stepper on the real cards, configurable connection Name.
- **Production wiring:** five credentials on Cloud Run (revision `gradfolio-api-00041-n75`
  onwards), Auth0 GitHub connection on Levon's own OAuth App keys.

## Defects found (this milestone)

- **Fixed:** production `AUTH0_DOMAIN` held `https://…`, so the FE guard returned "not
  available" without calling the API (#106). The GitHub connection Name is not `github`: Auth0
  logged "the connection is not enabled" with an empty `connection_id` (#107; Levon set the
  variable and connect then worked).
- **Open, user-facing:** **"Delete account" does not sign the user out.** On production the API
  deleted the account and revoked GitHub (204, logs), but `/auth/logout` was never requested,
  the session stayed valid, a new empty account was created and onboarding appeared. Cause not
  proven; the FE agent has it with reproduction instructions.
- **Open, review:** #101's two Codex P2s were fixed in #104; #107's P2 (name length 64 → 128) is
  unfixed on `main`.
- **Not caught by local tests, found only on production:** every one of the three config
  defects above. Real-token and production runs stay mandatory.

## Process notes (honest)

- **Reviewers:** Copilot failed on quota on every push. Codex answered again in M7 and is the
  review of record. No `[reviewer-agent]` run was needed except one that hit its usage limit.
- **Merges outside the gate:** 10 of 12 merged PRs. #101 and #107 merged with an unresolved
  Codex finding. #81 and #106 merged before Codex answered.
- **Agent outages:** both sub-agents hit usage limits several times and were resumed from
  their committed state. The API agent started Docker Desktop itself once.
- **Secrets:** none appeared in chat. The two client secrets went into Secret Manager through
  `pbpaste`.

## Not verified

- Real import, re-sync and disconnect on production (no FE screen; API-only checks passed).
- Token lifetime of the Auth0 Management API token, Token Vault on this plan, a real
  Management API 429, the status GitHub gives for an already-gone grant.
- Anything LinkedIn: real export headers, parser, ZIP guards, preview, confirm.
- The private-repository behaviour (deliberately out, D6: public scope only).
- ru/am wording of new strings (native review, OR-T6).

## Queue (manual-testing.md)

| ID         | State                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------ |
| M7-T0      | decisions D1–D8: D1 = Auth0 taken in practice; D3/D4 defaults used; **veto still open**          |
| M7-T1      | LinkedIn exports (you, Narek, Pargev): **waiting**, blocks PR (c) and FE PR 4                    |
| M7-T2, T11 | Auth0 connection on own keys, `Gradfolio` enabled, callback URLs, M2M app: **done** (2026-10-15) |
| M7-T3      | not needed (D2)                                                                                  |
| M7-T4      | real GitHub run on production: **waiting** on the FE import screen                               |
| M7-T5      | LinkedIn real run: waiting on T1 and PR (c)                                                      |
| M7-T6      | headed login for FE real runs: waiting                                                           |
| M7-T7      | LinkedIn screenshots: waiting                                                                    |
| M7-T8      | bucket lifecycle for `imports/`: waiting (after PR c)                                            |
| M7-T9      | Cloud Run wiring: **done** by the lead with Levon's OK                                           |
| M7-T10     | NPUA mail domains for suggestions: waiting                                                       |
| OR-T5      | Vercel `AUTH0_SECRET` and `AUTH0_CLIENT_SECRET` still `readable-secret`                          |

## Proposed tracker changes

- 7.1 done (Auth0 token source, D2 no cache). 7.2 done (no token at rest; rotation design not
  built by decision). 7.3, 7.4, 7.5 API done, FE open. 7.12 API done, FE open.
- **New 7.13:** profile data from connected integrations as suggestions (GitHub bio, avatar,
  company, location; LinkedIn identity changes), accept or dismiss, never silent.
- **New 7.14:** FE import wizard and re-sync UX (was inside 7.11).
- **New defect row:** account deletion does not sign out (FE).
- Follow-ups: connection-name limit 128; a startup check that logs which of the five GitHub
  settings is missing; a `useLayoutConfig`-style single source for Auth0 settings on Vercel;
  delete stale `AUTH0_ISSUER_BASE_URL`/`AUTH0_BASE_URL` and old `light_logo.png`/`dark_logo.png`;
  delete remote `origin/m7/*` branches; raise the Codex quota or accept self-review receipts.

## Next, in order

1. Fix account deletion sign-out (FE agent, in progress).
2. FE PR 3: repo picker → drafts → review, re-sync card, GitHub badge.
3. API PR (d) suggestions including GitHub profile data; FE inbox.
4. Real GitHub run on production (M7-T4) using `docs/m7-prod-run.md` and the observer.
5. LinkedIn PR (c) and FE PR 4 after M7-T1.
6. `m7-verification.md` and `fe-m7-verification.md`; final report.

## Changes needed in other repos

None. `gradfolio-sql` unchanged.

## Open questions for Levon

- Confirm profile data from GitHub as suggestions (7.13).
- Send the LinkedIn exports, or mark M7-T1 "skipped (decision)" and drop the real-run rows.
- Codex quota: raise it, or keep merging on Codex-or-nothing?

## Machine

Not clean: Docker project `gradfolio-m7` (MySQL 3315), worktrees `gradfolio-api-m7`,
`gradfolio-m7`, plus M6's leftovers (`gradfolio-api-m6`, `gradfolio-m6`) and dead local
branches. They stay until M7 closes.
