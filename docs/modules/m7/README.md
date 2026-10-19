# M7: GitHub integration and LinkedIn export import

**Status:** in progress. **Module chat:** Levon's M7 chat, from 2026-10-19 (before that, one
lead chat with sub-agents). **Repos:** gradfolio-api, gradfolio.

**Goal:** a connected integration brings the student's data into Gradfolio, not only a
connection. A student connects GitHub, imports repositories as draft projects, accepts
suggestions for profile fields, skills and links, and is told when a repository changes.
A student imports positions, education, skills and certifications from their own
LinkedIn data export. Nothing is imported or changed without the student's choice.

Tracker rows: 7.1–7.12 in [../../tracker.md](../../tracker.md#m7-github-integration-and-linkedin-export-import).
Rows proposed by the module chat (not yet in the tracker): **7.13** suggestions from
connected integrations (profile fields, skills, links, project changes) and **7.14** the
GitHub import dialog and its entry points. Decision Q8 (LinkedIn's API is closed; GitHub
yes) is in the tracker.

Documents of this module: [plan.md](plan.md) (design, decided, merged as #72),
[prod-run.md](prod-run.md) (the real run on production and its read-only observer),
`verification.md` (written by M7-T52). The prompt, report and addenda are in
[../../process/handoffs/m7/](../../process/handoffs/m7/prompt.md).

## What is already merged (reconciled with GitHub, 2026-10-19)

| Done                                                                                                                      | PRs                               |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 7.1 token source: Auth0 identity-provider token, nothing stored (plan D1, D2). 7.2 connect, link, disconnect, `verified`  | api #72, #73, #85, #88            |
| 7.3–7.5 repository list, import as drafts, re-sync that keeps the student's edits, README safety, `githubStars` has data  | api #79, #80                      |
| Repository search `q`, import preview, per-repo `overrides`; suggestions (profile fields from GitHub, LinkedIn sign-in)   | api #82, #83                      |
| Account deletion unlinks GitHub in Auth0; optional Auth0 user deletion behind `AUTH0_DELETE_USERS` (off)                  | api #85, #86, #89                 |
| 7.10 API: LinkedIn shown as connected when the sign-in identity is linked; name and photo suggestions                     | api #82                           |
| 7.11 integrations page on the API; connect/disconnect; onboarding stepper; configurable connection Name; `AUTH0_DOMAIN`   | fe #101, #104, #106, #107, #108   |
| 7.14 (part) GitHub import dialog (repos, review with edits, save as drafts), profile-data tab, re-sync card, source badge | fe #109, #111, #123               |
| Draft chip, quick Publish, Publish now                                                                                    | fe #121                           |
| 7.12 GitHub source badge and `verified`; hover contrast; flake fix; unknown-tag page                                      | api #80, fe #112, #110, #120/#122 |

Merged outside the lead's gate (from Levon's account, 10 of 14 before 2026-10-18) and
recorded in the report: among them #101, #107 and #121, which merged with an open Codex
finding. The findings were re-landed in #104, #123 and task M7-T30.

## Tasks

**Claiming a task:** before a chat starts on a task, its row goes to `in progress` in a docs PR, so anyone who looks sees it is taken. Only the chat that holds the claim moves it on.

**Status legend:** `todo` (not started), `in progress` (a task chat is working on it),
`review` (PR open), `done` (merged and deployed), `blocked` (waiting on something that is
not a task; the Depends column says what). The module chat updates this table in a small
<<<<<<< HEAD
docs PR whenever a task changes state. **Last updated: 2026-10-19** (done: T20–T24, T27, T28, T30, T29 (api #111), T31, T34 (fe #132), T36 (api #112); in progress: T25; free: T50, T52; blocked: T40–T43, T51).
=======
docs PR whenever a task changes state. **Last updated: 2026-10-19** (done: T20–T24, T25 (api #114), T27, T28, T30, T29 (api #111), T31, T34 (fe #132), T36 (api #112); in progress: none; free: T32, T33, T35, T50, T52; blocked: T40–T43, T51).
>>>>>>> origin/main

The **Status** column is the status of record. **Depends on** lists tasks that must be
**merged** first. Task IDs start at T20 because **M7-T1 to M7-T13 are Levon's queue rows**
in `manual-testing.md` (the things only he can do), and the two must never collide. In a
brief, "queue M7-T1" always means a queue row.

| ID     | Task                                                                        | Repo    | Depends on        | Tracker | Status      | Brief                                              |
| ------ | --------------------------------------------------------------------------- | ------- | ----------------- | ------- | ----------- | -------------------------------------------------- |
| M7-T20 | Skill suggestions from repo languages/topics and the student's own projects | api     | —                 | 7.13    | done        | [T20](tasks/M7-T20-skill-suggestions.md)           |
| M7-T21 | Links suggestions from GitHub social accounts                               | api     | T20               | 7.13    | done        | [T21](tasks/M7-T21-links-suggestions.md)           |
| M7-T22 | Repo-change suggestions and a notification (d2)                             | api     | T20               | 7.13    | done        | [T22](tasks/M7-T22-repo-change-suggestions.md)     |
| M7-T23 | Deletion tombstone: precondition of `AUTH0_DELETE_USERS`                    | api     | —                 | 7.2     | done        | [T23](tasks/M7-T23-deletion-tombstone.md)          |
| M7-T24 | Startup check: log which of the five GitHub settings is missing             | api     | —                 | 7.2     | done        | [T24](tasks/M7-T24-startup-check.md)               |
| M7-T25 | Education and organisation suggestions from verified emails and orgs        | api     | —                 | 7.13    | done        | [T25](tasks/M7-T25-education-suggestions.md)       |
| M7-T27 | Stuck GitHub connection: refused token, Disconnect cannot finish            | api     | —                 | 7.2     | done        | [T27](tasks/M7-T27-stuck-github-connection.md)     |
| M7-T28 | `GET /v1/me/suggestions?limit=100` answers 400                              | api, fe | —                 | 7.13    | done        | [T28](tasks/M7-T28-suggestions-limit-400.md)       |
| M7-T29 | Re-check the repository when accepting a `project.new` suggestion           | api     | —                 | 7.13    | done        | [T29](tasks/M7-T29-project-new-recheck.md)         |
| M7-T34 | Offer the import after every successful connect, and keep offering it       | fe      | —                 | 7.14    | done        | [T34](tasks/M7-T34-offer-import-after-connect.md)  |
| M7-T35 | Import dialog wording when only profile data is imported                    | fe      | —                 | 7.14    | in progress | [T35](tasks/M7-T35-profile-only-import-wording.md) |
| M7-T36 | Reconnect after a dead token: connect re-runs the GitHub sign-in            | api, fe | —                 | 7.2     | done        | [T36](tasks/M7-T36-reconnect-after-dead-token.md)  |
| M7-T30 | Focus and announcement after Publish on cards and the project page          | fe      | —                 | 7.14    | done        | [T30](tasks/M7-T30-publish-focus.md)               |
| M7-T31 | Import entry points: after connect, Projects → Add                          | fe      | —                 | 7.14    | done        | [T31](tasks/M7-T31-import-entry-points.md)         |
| M7-T32 | Suggestions inbox: skills, links, project changes, notification             | fe      | T20 (T21, T22)    | 7.13    | in progress | [T32](tasks/M7-T32-suggestions-inbox.md)           |
| M7-T33 | One source for the Auth0 settings read by the app                           | fe      | —                 | 7.11    | in progress | [T33](tasks/M7-T33-auth0-settings-source.md)       |
| M7-T40 | LinkedIn export: real headers, synthetic fixtures, parser                   | api     | queue M7-T1       | 7.6     | blocked     | [T40](tasks/M7-T40-linkedin-parser.md)             |
| M7-T41 | LinkedIn ZIP upload, guards and preview                                     | api     | T40               | 7.7     | blocked     | [T41](tasks/M7-T41-linkedin-upload-preview.md)     |
| M7-T42 | LinkedIn confirm: selected items become profile rows                        | api     | T41               | 7.8     | blocked     | [T42](tasks/M7-T42-linkedin-confirm.md)            |
| M7-T43 | LinkedIn import wizard (onboarding and integrations page)                   | fe      | T41, T42 deployed | 7.9     | blocked     | [T43](tasks/M7-T43-linkedin-wizard.md)             |
| M7-T50 | Real GitHub run on production                                               | api, fe | T20, T30, T31     | 7.1–7.5 | todo        | [T50](tasks/M7-T50-github-real-run.md)             |
| M7-T51 | Real LinkedIn run on production                                             | api, fe | T43, queue M7-T1  | 7.6–7.9 | blocked     | [T51](tasks/M7-T51-linkedin-real-run.md)           |
| M7-T52 | Verification records and the module report                                  | api, fe | all above         | —       | todo        | [T52](tasks/M7-T52-verification.md)                |

**Follow-up from T23 (open, not yet a task):** Codex P2 on `src/core/config/schema.ts`:
`ACCOUNT_TOMBSTONE_TTL_S` accepts values below the access-token lifetime plus the clock
tolerance, so a token can outlive its tombstone. The merged PR left the thread unanswered.
Fix: raise the minimum or check it at boot. Proposed as M7-T26 (small, todo).

**Follow-up from T20 (review gap):** PR #93 merged as `caa791a`. Codex reviewed `c4641a8`
and its two threads were answered and resolved, but the final head `3ed18fe` was never
reviewed by Codex before the merge. Rule: a merge needs Codex on the current head. The
fixes are small and are covered by tests; the gap is process, and is recorded here.

**Follow-up from T22 (open, not yet a task):** PR #105 merged as `58d1c1a` with one Codex P2 open
(`project-suggestions.service.ts`): accepting a `project.new` suggestion does not re-check
that the repository is still owned, public, non-fork and non-archived, so an archived or
transferred repo can still become a draft, while a refresh would have dropped the
suggestion. Fix: re-check on accept and answer `SUGGESTION_STALE`. Proposed as M7-T29 (small).

**Dropped as done:** connection-name limit 128 vs 64 (fe #108), the delete-account sign-out
(fe #108), the discovery flake (fe #110), the profile-tab fixes (fe #123), account deletion
unlinking GitHub (api #85/#88), the Auth0 user deletion code (api #86).

**Blocked tasks never start on guessed data.** The LinkedIn tasks need the real exports
(queue M7-T1). If they do not arrive, M7 closes without them, as "not run by decision",
and the exit says so.

## Order and parallel lanes

```
Lane G (GitHub data, api):  T20 ──► T21
                                └──► T22
                            T23, T24 (independent)      T25 ready (domain given)
Lane F (frontend):          T30, T31, T33 (independent)
                            T32 after T20 (grows with T21, T22)
Lane L (LinkedIn):          T40 ──► T41 ──► T42 ──► T43        (all wait for queue M7-T1)
Real runs and close:        T50 after T20, T30, T31;  T51 after T43;  T52 after all
```

- **Start in parallel:** T20 (already running), T23, T24, T30, T31, T33.
- **One API task at a time touches `src/api/suggestions/`** (T20, T21, T22, T25): they
  are chained for that reason.
- **Merge order:** an FE PR that calls a new endpoint merges only after that API PR is
  merged and the API Deploy workflow is green.
- **Migrations:** T22 adds one. Take the next free number on the latest `main`; M8 adds
  migrations at the same time.

## Next waves (2026-10-19)

Run tasks in waves so that tasks in one wave share no files. A wave starts when the one before it
is merged and deployed, except where the table says otherwise.

| Wave | Tasks (parallel)                           | Why together                                                                                                                                                                                                     |
| ---- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **T36** (api), **T29** (api), **T34** (fe) | T36 touches `github-connection.service.ts`; T29 touches `project-suggestions.service.ts`; T34 touches the GitHub card and the integrations page. No shared files.                                                |
| 2    | **T35** (fe), **T32** (fe)                 | T35 changes the import dialog's wording; T32 builds the inbox on the integrations page. **T32 starts after T34 merges** (same page). T35 can start with wave 1 if a slot is free (shares only the locale files). |
| 3    | **T33** (fe), **T50** (real run)           | T33 touches the connect action and callback, which T36 may change, so it follows T36. T50 needs T36, T34 and T35 deployed so the run exercises the fixed flows.                                                  |
| 4    | T52                                        | Verification and the module report.                                                                                                                                                                              |

LinkedIn (T40–T43, T51) stays blocked until Levon's queue row M7-T1 is done. **T25 is ready** (the domain arrived): it joins wave 2, after T29 (both touch `src/api/suggestions/`).

## Rules for every M7 task

- Follow [../README.md](../README.md) for chat levels, status, merging and "Needs Levon".
- Follow each repo's `CLAUDE.md` and `AGENTS.md`: the four phases, guards proved by
  removal, races forced with a barrier. Real answers from Auth0 and GitHub, not
  hand-built ones, decide a mapping table: a fake that follows the docs is not a recording.
- **Both reviewers on every push** (`sh scripts/request-review.sh <pr>`). When Codex does
  not answer, a reviewer sub-agent with fresh context reviews instead.
- **M8 runs in parallel** (Narek, his own machine, branches `m8/*`, and the Settings page,
  `src/lib/api/client.ts` and the locales are shared files). Do not touch his branches.
  Rebase on `main` before every push.
- **Production:** every merge to `main` deploys (API to Cloud Run, FE to Vercel).
  Migrations are additive and safe while the previous revision still serves.
- **Privacy:** real LinkedIn exports are personal data. They are never committed, never
  pasted into a chat, never attached to a PR. Agents read file names and column headers
  only, and build synthetic fixtures.
- **Secrets:** never in a brief, a PR, a chat or a file. Levon puts secrets into Secret
  Manager himself.

## Needs Levon (queue, kept in `manual-testing.md`)

| Queue    | What                                                                                                                                                   | Blocks       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| M7-T1    | Request the LinkedIn export (the larger archive); Narek and Pargev send header lines only                                                              | T40–T43, T51 |
| M7-T4/T6 | Headed login and the real GitHub run on production                                                                                                     | T50          |
| M7-T5    | The real LinkedIn run                                                                                                                                  | T51          |
| M7-T7    | Capture and redact the LinkedIn export-download screenshots (four per language)                                                                        | T43          |
| M7-T8    | Bucket lifecycle for `imports/` (age one day)                                                                                                          | T41          |
| M7-T10   | The NPUA mail domains for `UNIVERSITY_DOMAINS`                                                                                                         | T25          |
| M7-T13   | Auth0 Management API scope `delete:users` on the M2M app, then `AUTH0_DELETE_USERS=true` on Cloud Run. **Only after T23 is merged.** Levon decided yes | —            |

## Exit

- A student connects GitHub, imports two repositories as drafts, edits one and publishes
  it, re-syncs it, and the edits survive. Disconnecting removes the connection at GitHub
  and in Auth0. Deleting the account leaves nothing linked.
- Profile fields, skills and links from GitHub are offered as suggestions and accepted or
  dismissed one at a time. A changed README or description upstream produces a
  notification and a suggestion, never an overwrite.
- A real LinkedIn export previews correctly, confirming adds only the selected items, a
  second import adds nothing, and a malformed or oversized ZIP is refused with a stable
  code. (Or recorded as "not run by decision".)
- Every endpoint is in `openapi.yaml`, has a request in `http/`, an ownership test and a
  second-user 404. Production `/readyz` is 200.
- `verification.md` in this folder and the frontend record record each check (T52).
