# Tracker

This is the status of record for the whole Gradfolio release, across all three
repositories:

- `gradfolio-api` (this repo);
- `gradfolio` (frontend);
- `gradfolio-sql` (schema);
- plus the Auth0 tenant and the deployments.

The orchestrator updates it after validating a worker's report. Workers propose
changes in their report instead of editing this file, so two chats never edit it at
once.

Last updated: 2026-09-28, by the orchestrator, after the stack decision (NestJS) and
setup PR #6 went green. `main` is at `da3d495`.

**Sources this plan is built from:**

- [investigation.md](investigation.md): schema facts verified on MySQL 8.4, gaps
  between frontend and schema, decisions Q1–Q10;
- the feature spec, in the workspace `docs/`;
- `issues.md`, in the workspace root: issue IDs S\* (gradfolio-sql), F\* (gradfolio)
  and P\* (spec vs schema);
- a check of the live frontend on 2026-09-28.

**Legend.**

- Status: `done` · `review` (PR open) · `next` · `todo` · `blocked` · `stretch`
  (after v1.0 if time allows) · `out` (not in this project).
- Repo: `api` · `fe` · `sql` · `auth0` · `ops` · `all`.

---

## Now

- **Setup:** #1–#5 merged.
  - **#6** (NestJS skeleton, toolchain, Docker, CI) is open, and all 4 CI jobs pass.
    Merge it once the review round is done.
  - This tracker PR also edits `docs/tracker.md`. Whichever of the two merges second
    takes this version.
- **M1 done** (#9 plan, #11, #12 merged; gradfolio-sql#1 in review).
  - Validated against GitHub on 2026-09-29.
  - One fix-now item is routed to the M1 worker: plan thread #9 P1, migration DML
    and its step record are not atomic.
- **Next: M2**, auth and identity. Its handoff is written next.
- **Blocking the merge gate:** Copilot's review quota is exhausted, so every Copilot
  "review" since 2026-09-29 is a quota failure. Until Levon decides (wait, upgrade,
  or temporarily accept Codex alone), no code PR can pass
  `scripts/review-status.sh`.
- **Decisions still open, each made by the module that needs it:**
  - Q7 and Q11 in M2;
  - Q3 in M3;
  - Q5 and Q6 in M4;
  - Q4 in M5;
  - Q10 in M8;
  - Q9 in M9.
- **Merge gate:**
  - Merge a code PR only after **both reviewers (GitHub Copilot and Codex)** have
    reviewed the head commit (`sh scripts/review-status.sh <n>` exits 0) and the
    orchestrator has validated it. Both are requested on every push with
    `sh scripts/request-review.sh`.
  - Docs-only PRs: both reviewers are still requested, but merging does not wait for
    them.
- **Levon's setup (kit §9), still open:**
  - turn on auto-delete of head branches (it is **off**);
  - turn on Dependabot security updates;
  - optional: a branch ruleset with "Automatically request Copilot code review", so
    Copilot is requested even when a push forgets the script;
  - run `/reload-skills` in any chat that should run `/gradfolio-review`.

## Release definition: v1.0

v1.0 is **the spec's §8 user journey, working end to end on the deployed system**,
minus the parts the spec itself marks optional. Concretely, a student can:

- sign up (email/password, Google, GitHub or LinkedIn via Auth0) and have a profile
  created on first login;
- fill in their profile: header, education, experience, certifications and skills.
  Editing is saved and survives a reload;
- create, edit and delete projects: rich description, tech tags, metadata, links,
  attachments, privacy;
- tag teammates, who accept or reject, and see accepted projects on their own
  profile, with notifications for both;
- link GitHub, import selected repos as draft projects, and re-sync them by hand;
- search and browse people, projects and tags, and view a public portfolio **without
  logging in** (the §8d recruiter path);
- see a dashboard with their stats, recent projects and activity;
- download a résumé PDF (scope to be confirmed in Q10).

All of this runs on the deployed frontend (Vercel), API and MySQL (Aiven), in all
three UI languages (en/ru/am), with the release checks in M9 passed.

### Spec feature → scope

| Spec feature                                          | v1.0                                                                                             | Milestone |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------- |
| §1 Sign-up (email/password + Google/LinkedIn/GitHub)  | in (Auth0 social + database connections)                                                         | M2        |
| §1 Profile initialization on first login              | in                                                                                               | M2        |
| §1 Email verification                                 | in, via Auth0's own flow and `email_verified`                                                    | M2        |
| §1 Phone OTP                                          | stretch (the spec calls it optional)                                                             | —         |
| §1 External account linking (GitHub/LinkedIn)         | in: GitHub (API access); LinkedIn as a login identity only                                       | M7        |
| §2 LinkedIn import                                    | in, **from LinkedIn's data export** (ZIP upload → review → save); the API does not allow it (Q8) | M7        |
| §2 GitHub import + manual re-sync                     | in                                                                                               | M7        |
| §3 Profile page: all sections + edit mode             | in                                                                                               | M3        |
| §4 Project page, list, add/edit, attachments, tags    | in                                                                                               | M4        |
| §4 Team members with approval                         | in                                                                                               | M5        |
| §4 AI summary / tag suggestions                       | per Q10: manual field is always in, generation is stretch                                        | M8        |
| §4 Live-site preview (iframe/screenshot)              | stretch                                                                                          | —         |
| §4 Comments                                           | out (the spec says future scope)                                                                 | —         |
| §5 Verification: badges from Auth0/GitHub signals     | in (small)                                                                                       | M2/M7     |
| §5 Education/certificate document verification, admin | out (spec: "very optional, can be skipped")                                                      | —         |
| §6 Search, tag pages, browse projects, browse users   | in                                                                                               | M6        |
| §6 Tag cloud                                          | in                                                                                               | M6        |
| §6 Similar projects / people                          | stretch                                                                                          | M6        |
| §6 Public vs private content                          | in (rules per Q3)                                                                                | M3/M4     |
| §7 Résumé PDF                                         | in (per Q10)                                                                                     | M8        |
| §7 Portfolio PDF export                               | stretch                                                                                          | M8        |
| §7 Share by email                                     | stretch (needs an email provider)                                                                | M8        |
| §7 Notifications                                      | in (team events; the rest as features exist)                                                     | M5        |
| §7 Admin interface                                    | out (moderation by script if ever needed)                                                        | —         |

## Decisions

The details and options for each are in [investigation.md](investigation.md) §6.
"Proposed" is the orchestrator's starting position: M0 confirms it by running the
relevant checks, and Levon decides the product calls.

| ID  | Question                                     | Status                   | Proposed / decided                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Stack                                        | **decided**              | NestJS 12, Node 24, TypeScript 6.0, zod, pino, mysql2, Vitest (#6)                                                                                                                                                                                                                                                                                                                                                                                         |
| Q2  | Who owns the schema, and how migrations work | **decided (M1, #9)**     | The API owns the schema: per-step migrations in `src/core/db/migrations` (one DDL statement per step, each recorded as it succeeds, guarded so a retry converges). Baseline 0001 = `gradfolio-sql` `schema.sql`@187ff66, proven identical in CI. `gradfolio-sql` is reference only, and its README points to the API.                                                                                                                                      |
| Q3  | Privacy rules                                | open (M0, Levon)         | Private profile or project: 404 to everyone except the owner; excluded from search and browse. The spec's "direct link" variant is the alternative.                                                                                                                                                                                                                                                                                                        |
| Q4  | Owner and teammate model                     | open (M0, Levon)         | The owner is implicit (`projects.user_id`), with no member row. Teammates without an account are allowed, named only, no invite.                                                                                                                                                                                                                                                                                                                           |
| Q5  | API contract and type sharing                | open (M0)                | `openapi.yaml` (already generated) → TypeScript types generated in the frontend (`openapi-typescript`), checked in CI.                                                                                                                                                                                                                                                                                                                                     |
| Q6  | File storage                                 | open (M0)                | Candidates: Vercel Blob, Cloudflare R2, S3, Cloudinary. v1 could stay URL-only apart from avatars and hero images.                                                                                                                                                                                                                                                                                                                                         |
| Q7  | When the user row is created                 | open (M0)                | Upsert on `auth0_id` at the first authenticated request (`GET /v1/me`). Race-safe; proven with a barrier test.                                                                                                                                                                                                                                                                                                                                             |
| Q8  | Integrations scope                           | **decided (2026-09-28)** | GitHub: full API import. LinkedIn: the API is closed. Its only open permissions are sign-in (name, headline, photo, email). Positions, education, skills and certifications need partner programs ([Getting Access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access), updated 2026-06). So: LinkedIn sign-in pre-fills the profile, import is by uploading the member's own data export, and manual entry is the fallback. |
| Q9  | Hosting, and MySQL for tests                 | open (M0)                | API on a container host that can reach Aiven over TLS. Tests use the compose/CI MySQL 8.4 (already working in #6).                                                                                                                                                                                                                                                                                                                                         |
| Q10 | AI summary, PDF, email                       | open (M0, Levon)         | AI: provider chosen, optional, rate-limited, and the feature degrades if the provider is down. PDF: pick a generator. Email: stretch.                                                                                                                                                                                                                                                                                                                      |
| Q11 | How the frontend calls the API               | open (M0) — new          | From the Next.js server only (server components, route handlers, server actions), with the access token kept server-side. No CORS needed.                                                                                                                                                                                                                                                                                                                  |
| Q12 | Query layer on top of `mysql2`               | **decided (M1, #9)**     | Kysely, with row types generated from the database (checked in CI by `db:types:check`) plus overrides: ids required, `TINYINT(1)` → boolean, DATE → text, JSON columns written only through `toJsonColumn`.                                                                                                                                                                                                                                                |

## Milestones

| #   | Name                                   | Repos          | Status                                            | Depends on                | Plan                  | Verification                          |
| --- | -------------------------------------- | -------------- | ------------------------------------------------- | ------------------------- | --------------------- | ------------------------------------- |
| M0  | Foundations: setup + architecture plan | api, all       | done; 0.5, 0.7–0.9 open                           | —                         | —                     | —                                     |
| M1  | Data layer, schema ownership, DB fixes | api, sql       | done (sql#1 and the DML-atomicity follow-up open) | M0                        | [m1-plan](m1-plan.md) | [m1-verification](m1-verification.md) |
| M2  | Auth and identity, end to end          | auth0, api, fe | todo                                              | M0, M1                    | —                     | —                                     |
| M3  | Profiles                               | api, fe        | todo                                              | M2                        | —                     | —                                     |
| M4  | Projects and media                     | api, fe        | todo                                              | M3                        | —                     | —                                     |
| M5  | Teams and notifications                | api, fe        | todo                                              | M4                        | —                     | —                                     |
| M6  | Discovery and dashboard                | api, fe        | todo                                              | M4 (M5 for team projects) | —                     | —                                     |
| M7  | GitHub + LinkedIn (export) import      | api, fe, auth0 | todo                                              | M4                        | —                     | —                                     |
| M8  | Utilities: résumé PDF, AI summary      | api, fe        | todo                                              | M3, M4                    | —                     | —                                     |
| M9  | Hardening, deployment and v1.0 release | all            | todo                                              | M1–M8                     | —                     | —                                     |

**Working in parallel** once M2 lands:

- Frontend work on a feature starts when that feature's API contract (its
  `openapi.yaml` operations) is merged. The frontend builds against the generated
  types, with fixtures until the endpoint exists.
- M7 and M8 can run beside M5 and M6.
- Each milestone keeps to its kit shape: **one plan PR, then two or three
  implementation PRs per repo**, then `docs/mN-verification.md`.

---

## M0: Foundations

**Goal:** the repository, process and decisions every later milestone builds on.

| ID  | Task                                                                                                                             | Repo | Status | Source                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ----------------------------------------------------------------- |
| 0.1 | Orchestrator kit: CLAUDE.md, AGENTS.md, handoff template, push gates, `.review/`, `gradfolio-review` skill                       | api  | done   | #1, #2                                                            |
| 0.2 | Investigation, tracker, rename to `gradfolio-api`, README                                                                        | api  | done   | #3, #4                                                            |
| 0.3 | Repo hygiene: editorconfig, gitattributes, license, CoC, contributing, security, templates, Dependabot, VS Code                  | api  | done   | #5                                                                |
| 0.4 | NestJS skeleton: config, logging, errors, MySQL pool (UTC session), health, OpenAPI, Docker, compose, CI (4 jobs), `http/`       | api  | review | #6                                                                |
| 0.5 | Levon's settings: auto-delete branches, Dependabot security updates, optional Copilot auto-review ruleset (Codex app: installed) | ops  | todo   | kit §9                                                            |
| 0.6 | Architecture decisions, made per module rather than up front (see Now). Q1 decided; Q8 decided                                   | api  | done   | investigation §6                                                  |
| 0.7 | Frontend baseline: `npm ci`, build, lint and knip on `gradfolio` main. Record what fails.                                        | fe   | done   | —, gradfolio #8–#12                                               |
| 0.8 | Frontend CI (lint, typecheck, build) plus a PR template, so more developers can work in the repo safely                          | fe   | done   | —, gradfolio #8–#12; push-gate fixes ported to the API in #18/#19 |
| 0.9 | Workspace docs into version control: spec + competitor analysis → `gradfolio-api/docs/spec/` (or the frontend repo)              | api  | todo   | spec lives outside every repo                                     |

**Exit:** #6 merged; the M0 plan merged, with every Q decided or explicitly deferred;
frontend baseline recorded.

## M1: Data layer, schema ownership, DB fixes

**Goal:** one source of truth for the schema, a typed query layer, and none of the
known schema defects carried into the API.

| ID   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Repo | Status | Source                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------ | --------------------------- |
| 1.1  | Migration runner (`migrate` / `migrate:down`, recorded in a table). **MySQL commits DDL implicitly** ([8.4 manual](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)), so a migration cannot be rolled back as a transaction. Rules: one DDL statement per migration step; each step recorded as soon as it succeeds; guarded DDL (`IF NOT EXISTS` / an `information_schema` check) so a retry after a partial failure converges. Test: a deliberately failing multi-step migration leaves a state that the next run completes. CI job: apply → re-apply is a no-op → roll back → re-apply | api  | done   | Q2, #7 review, #11          |
| 1.2  | Baseline migration = current `schema.sql` (11 tables), verified identical: `SHOW CREATE TABLE` diff against a `gradfolio-sql` load                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | api  | done   | Q2, #11                     |
| 1.3  | Query layer (per Q12), with generated or declared row types, snake_case → camelCase mapping and `TINYINT(1)` → boolean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | api  | done   | Q12, investigation 3.1, #12 |
| 1.4  | Ids generated in the app (UUID) on every insert; never rely on `DEFAULT (UUID())`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | api  | done   | S2 / D1, #12                |
| 1.5  | Shared validators: JSON array shapes (`string[]`, `{label,url}[]`), `YYYY-MM`, URL scheme (http/https only), MySQL character limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | api  | done   | S7 / D5, #12                |
| 1.6  | Tag normalization: `project_technologies` and `project_tags` tables plus a case-insensitive `terms` registry (one canonical spelling per term; legacy values normalized in 0003)                                                                                                                                                                                                                                                                                                                                                                                                                       | api  | done   | S9 / D4, #12                |
| 1.7  | Schema migrations for v1 features: `projects.source` (manual/github) + `github_repo_id`, repo `stars`/`forks`/`language`, a draft/published flag for imports, re-invite rules per Q4                                                                                                                                                                                                                                                                                                                                                                                                                   | api  | done   | P3, spec §2, #12            |
| 1.8  | Optional defence in depth: `CHECK (JSON_TYPE(col) = 'ARRAY')` and `YYYY-MM` CHECKs, with a plan for existing rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | api  | done   | S7, #12                     |
| 1.9  | Test helpers: truncate between integration files, fixtures/factories for users and projects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | api  | done   | —, #12                      |
| 1.10 | Dev/demo seed via the migration toolchain (realistic data in all three languages), with fixed notification links                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | api  | done   | S11, S12, #12               |
| 1.11 | `gradfolio-sql`: compose crash on a fresh volume (mount schema and seed only, or rename to `01-`/`02-`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | sql  | review | S1 / D9, sql#1              |
| 1.12 | `gradfolio-sql`: docs say 12 tables (there are 11), the "GENERATED ALWAYS" comment and "omit id" are wrong; say who owns the schema after Q2                                                                                                                                                                                                                                                                                                                                                                                                                                                           | sql  | review | S2, S13, sql#1              |
| 1.13 | `gradfolio-sql`: `queries.sql` ownership, visibility and transaction bugs fixed, or the file marked "illustrative, do not copy"                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | sql  | review | S3–S6, sql#1                |
| 1.14 | `gradfolio-sql`: seed owner-as-member made consistent with Q4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | sql  | review | S11, sql#1                  |

**Exit:** migrations run in CI up and down, and a partially failed migration recovers on the next run; baseline proven identical to
`schema.sql`; `gradfolio-sql` fixed or archived with a pointer.

## M2: Auth and identity, end to end

**Goal:** a real login on the frontend produces an access token that the API
verifies, and it resolves to exactly one `users` row.

**Facts from the 2026-09-28 check:**

- Production Auth0 is configured, using a `dev-…` tenant.
- The login redirect sends **no `audience`**, so no API-scoped access token is issued
  today.
- Pages answer 200 when logged out, so the middleware does not enforce login.
- No frontend code reads the session.

| ID   | Task                                                                                                                                                                                                                                                                                                                            | Repo  | Status                                                                                   | Source            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------- | ----------------- |
| 2.1  | Auth0: create the **API** (identifier = audience, RS256, access-token lifetime); give the Next.js app access to it                                                                                                                                                                                                              | auth0 | partly done (API created 2026-10-02; per-app access pending: auth0-setup §10.3)          | this check        |
| 2.2  | Auth0: connections (database with email verification, Google, GitHub, LinkedIn); allowed callback/logout URLs for localhost, Vercel production and previews                                                                                                                                                                     | auth0 | partly done (localhost + production callbacks set; connections not yet confirmed: §10.8) | spec §1           |
| 2.3  | Auth0: decide a separate production tenant vs the current `dev-…` one; decide account linking for the same email across social logins                                                                                                                                                                                           | auth0 | todo                                                                                     | —                 |
| 2.4  | Auth0: a post-login Action adding namespaced claims (`email_verified`, email, name, picture, identities) to access tokens for the API (m2-plan §3.4)                                                                                                                                                                            | auth0 | partly done (created + deployed; **trigger binding unconfirmed**: §10.1)                 | §5 verified badge |
| 2.17 | Auth0 hygiene from the 2026-10-02 tenant check: Action bound to post-login, Client Credentials off, API user access per-app (only `Gradfolio`), legacy `gradfolio` (Vercel integration, Implicit grant) and `Default App` removed, origin lists cleared, Universal Login and refresh-token settings confirmed (auth0-setup §10) | auth0 | todo                                                                                     | 2026-10-02 check  |
| 2.5  | API: JWT guard with `jose` (remote JWKS with caching, fixed issuer, audience, expiry, RS256 only). Tests reject `alg: none`/HS256, a wrong audience, an expired token and a forged signature                                                                                                                                    | api   | todo                                                                                     | AGENTS.md         |
| 2.6  | API: `@CurrentUser`; race-safe first-login provisioning (upsert on `auth0_id`, barrier test with two concurrent first requests); `GET /v1/me`                                                                                                                                                                                   | api   | todo                                                                                     | Q7                |
| 2.7  | API: global rate limiter (`@nestjs/throttler`), with per-endpoint budgets reserved for search, import and AI                                                                                                                                                                                                                    | api   | todo                                                                                     | AGENTS.md         |
| 2.8  | FE: set `AUTH0_AUDIENCE` (and the scope) locally and on Vercel; confirm the authorize URL carries the audience                                                                                                                                                                                                                  | fe    | todo                                                                                     | this check        |
| 2.9  | FE: API client (server-only, per Q11): `auth0.getAccessToken()`, base URL from env, error envelope → typed errors, generated types (Q5)                                                                                                                                                                                         | fe    | todo                                                                                     | Q5, Q11           |
| 2.10 | FE: route policy. Public: `/`, `/profile/[id]`, `/projects/[id]`, `/search`, browse. Login required: dashboard, editing, new/edit project, integrations, account                                                                                                                                                                | fe    | todo                                                                                     | spec §8d          |
| 2.11 | FE: middleware fails closed on protected routes (no swallowed errors)                                                                                                                                                                                                                                                           | fe    | todo                                                                                     | F2                |
| 2.12 | FE: remove hardcoded `u_001` (3 places); "My profile" and `isOwnProfile` come from `/v1/me`                                                                                                                                                                                                                                     | fe    | todo                                                                                     | F3                |
| 2.13 | FE: auth-aware navigation (login vs avatar/logout; hide "Login" and "Login Connections" when signed in)                                                                                                                                                                                                                         | fe    | todo                                                                                     | nav check         |
| 2.14 | FE: first-login profile initialization (name, photo, bio pre-filled from Auth0; **headline too when signing in with LinkedIn**), replacing the stepper's free-text steps                                                                                                                                                        | fe    | todo                                                                                     | spec §1, F4       |
| 2.15 | FE docs: Auth0 v4 variable names in CLAUDE.md/README; add `.env.example`                                                                                                                                                                                                                                                        | fe    | todo                                                                                     | F6                |
| 2.16 | Verified badge v1: email verified (Auth0) + linked GitHub (M7) → `users.verified`                                                                                                                                                                                                                                               | api   | todo                                                                                     | spec §5           |

**Exit:** on a Vercel preview, log in with each connection, then `GET /v1/me` returns
the same user id on a second login. Logged out, a public profile URL renders and
`/dashboard` redirects to login.

## M3: Profiles

**Goal:** the profile page and edit mode run on real data.

| ID   | Task                                                                                                                                                      | Repo | Status | Source     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ---------- |
| 3.1  | API: `GET /v1/users/:id` public profile. Visibility per Q3; `birthday`, `phone`, `auth0_id` and tokens never included; accepted team projects included    | api  | todo   | S5, Q3     |
| 3.2  | API: `GET`/`PATCH /v1/me/profile` (header, bio, links, contact email, `is_public`)                                                                        | api  | todo   | spec §3    |
| 3.3  | API: create/update/delete education, experience and certifications, each scoped to the owner (0 rows → 404) and validated (years, `YYYY-MM`, JSON arrays) | api  | todo   | S7         |
| 3.4  | API: `PUT /v1/me/skills` replace-all in **one transaction**; skill names normalized                                                                       | api  | todo   | S6         |
| 3.5  | API: reorder endpoints (`sort_order`) for every ordered section, atomic                                                                                   | api  | todo   | schema     |
| 3.6  | API: account deletion (cascade; team member rows keep the name) — decide if it is in v1                                                                   | api  | todo   | schema FKs |
| 3.7  | FE: profile page and edit mode on the API; delete `profile.mock.ts`/`portfolios.mock.ts` usage; loading, error and empty states                           | fe   | todo   | —          |
| 3.8  | FE: fix type mismatches (avatar fallback, `website`/`bio` shown, 6-value category) via the generated types                                                | fe   | todo   | F4         |
| 3.9  | FE: Account page (currently a 12-line placeholder): privacy toggle, contact email, linked accounts, delete account (if 3.6)                               | fe   | todo   | fe check   |
| 3.10 | FE: every new string in en/ru/am (the dictionary type enforces it)                                                                                        | fe   | todo   | —          |

**Exit:** edit every section, reload, and it persists. A second user cannot change any
of it (404 tests). A private profile follows Q3.

## M4: Projects and media

**Goal:** full project create, edit and view, with safe rich text and media.

| ID   | Task                                                                                                                                                                                                                                  | Repo | Status | Source      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ----------- |
| 4.1  | API: project create/read/update/delete. Owner-only writes; visibility per Q3 on every read; metadata, links, files, tags, technologies validated                                                                                      | api  | todo   | S5, spec §4 |
| 4.2  | API: `description_html` sanitized **on write** with an allow-list sanitizer (`sanitize-html` or DOMPurify + jsdom); a corpus of known XSS bypasses as tests                                                                           | api  | todo   | F1          |
| 4.3  | API: attachments add/update/delete/reorder; URL scheme check; type-specific rules (video embeds, PDF)                                                                                                                                 | api  | todo   | spec §4     |
| 4.4  | API: list own projects (all states) and a user's public projects; sort and filter parameters                                                                                                                                          | api  | todo   | fe page     |
| 4.5  | Storage (Q6): signed uploads for avatars, hero images and attachments; size and type limits; delete the object when its row is deleted                                                                                                | api  | todo   | Q6          |
| 4.6  | FE: **project form rebuilt**. Today it has only title, AI summary, demo URL, repo URL and attachments. Add summary, rich-text description (editor choice), category, status, technologies, tags, dates, course, professor, visibility | fe   | todo   | fe check    |
| 4.7  | FE: **edit project page** (no `/projects/[id]/edit` route exists) and delete with confirmation                                                                                                                                        | fe   | todo   | fe check    |
| 4.8  | FE: replace the regex sanitizer with DOMPurify (second layer)                                                                                                                                                                         | fe   | todo   | F1          |
| 4.9  | FE: `next.config.ts` image domains for the storage host (Q6)                                                                                                                                                                          | fe   | todo   | F5          |
| 4.10 | FE: projects list and detail on the API; delete `project.mock.ts`; the attachment form's hardcoded English labels moved into i18n                                                                                                     | fe   | todo   | fe check    |

**Exit:** a project with every field and attachment type round-trips. The XSS corpus
is neutralized on write. Private projects follow Q3.

## M5: Teams and notifications

| ID  | Task                                                                                                                                                                                       | Repo | Status | Source      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------ | ----------- |
| 5.1 | API: invite a teammate (owner only; user lookup), external named teammates per Q4, remove a member                                                                                         | api  | todo   | S4, Q4, P2  |
| 5.2 | API: accept or reject (invitee only, `pending` only; re-invite after a rejection by UPDATE)                                                                                                | api  | todo   | D6          |
| 5.3 | API: accepted team projects appear on the teammate's profile and in their lists                                                                                                            | api  | todo   | spec §4     |
| 5.4 | API: notifications written on invite/accept/reject in the same transaction as the change; list, unread count, mark one or all read (**scoped to the owner**); links computed from real ids | api  | todo   | S3, S12     |
| 5.5 | API: activities written on project and profile events (the dashboard feed)                                                                                                                 | api  | todo   | schema      |
| 5.6 | FE: team management on the project page (search a user, invite, pending state, remove)                                                                                                     | fe   | todo   | no UI today |
| 5.7 | FE: notifications UI (bell with unread count, list, accept/reject inline); `Notification` type                                                                                             | fe   | todo   | no UI today |

**Exit:** in a two-account journey, the invite is seen, accepted and the project
appears on both profiles. The other party's notifications are unreadable and cannot be
marked (404).

## M6: Discovery and dashboard

| ID   | Task                                                                                                                                                | Repo | Status  | Source        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- | ------------- |
| 6.1  | API: global search grouped into people and projects; FULLTEXT plus a fallback for short tokens (`AI`, `ML`, `Go`, `C#`); public content only        | api  | todo    | S8 / D3       |
| 6.2  | API: tag search and tag pages (projects + people for a skill or technology), case-insensitive                                                       | api  | todo    | S9 / D4       |
| 6.3  | API: browse projects (sort newest, category, most viewed per P3) and browse users (filter by school, major, graduation year from education)         | api  | todo    | spec §6       |
| 6.4  | API: tag cloud (skills + technologies)                                                                                                              | api  | todo    | spec §6       |
| 6.5  | API: dashboard (counts, recent projects, activity feed, recent activity count). Drop or implement `githubStars` (M7 data) and `linkedinConnections` | api  | todo    | F4            |
| 6.6  | API: view counting, if "most viewed" is in scope (P3)                                                                                               | api  | stretch | P3            |
| 6.7  | API: similar projects / people with similar skills                                                                                                  | api  | stretch | spec §6       |
| 6.8  | FE: search page on the API (keep or drop the client-side "Developers/Designers…" heuristic); clickable tags go to tag pages                         | fe   | todo    | —             |
| 6.9  | FE: browse-projects gallery and browse-users directory (new pages)                                                                                  | fe   | todo    | no page today |
| 6.10 | FE: dashboard on the API; delete `dashboard.mock.ts`                                                                                                | fe   | todo    | —             |

**Exit:** searching "IoT", "ML" or an Armenian name finds what it should, and private
content never appears.

## M7: GitHub integration and LinkedIn export import

| ID   | Task                                                                                                                                                                                                                                                      | Repo       | Status | Source      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ----------- |
| 7.1  | Decide the token source: Auth0 identity-provider token for the GitHub connection (Management API) vs a separate GitHub OAuth app run by the API. Run both options before choosing                                                                         | api, auth0 | todo   | Q8          |
| 7.2  | API: connect/disconnect; tokens **encrypted at rest** (AES-256-GCM, key from env, rotation note); never in responses or logs                                                                                                                              | api        | todo   | S10         |
| 7.3  | API: list repos, import the selected ones as **draft** projects (name, description, language, stars, forks, README → description), deduplicated by `github_repo_id`                                                                                       | api        | todo   | spec §2     |
| 7.4  | API: manual re-sync per project (no silent overwrites of fields the user edited)                                                                                                                                                                          | api        | todo   | spec §2     |
| 7.5  | API: README fetched only through the GitHub API, sanitized like any description; no URLs supplied by the user are fetched                                                                                                                                 | api        | todo   | SSRF rule   |
| 7.6  | LinkedIn: get a real data export (LinkedIn → Settings → Data privacy → Get a copy of your data) from each team member and record its actual file names and columns. The parser is written against real files, not remembered names                        | api        | todo   | Q8          |
| 7.7  | API: `POST /v1/me/imports/linkedin`: upload the export ZIP (size cap, ZIP-bomb and path-traversal guards, CSV only, never written to disk unchecked) → parse positions, education, skills and certifications → return a **preview**; nothing is saved yet | api        | todo   | Q8          |
| 7.8  | API: confirm the import. Selected items become profile rows in one transaction, deduplicated against existing rows; `YYYY-MM` and year validation as in manual entry; `integrations.linkedin.last_synced_at` updated                                      | api        | todo   | Q8, spec §2 |
| 7.9  | FE: LinkedIn import wizard (instructions to download the export, upload, preview with per-item checkboxes, confirm) in the onboarding flow and on the integrations page                                                                                   | fe         | todo   | spec §2     |
| 7.10 | LinkedIn sign-in pre-fill: name, headline and photo from Auth0's LinkedIn connection on first login (with 2.14). The integration card shows LinkedIn as connected when that identity is linked                                                            | api, fe    | todo   | Q8          |
| 7.11 | FE: integrations page on the API (status, last synced, connect/disconnect), import wizard (repo picker → drafts → review)                                                                                                                                 | fe         | todo   | —           |
| 7.12 | GitHub-source badge on imported projects; "linked GitHub" counts toward `verified`                                                                                                                                                                        | api, fe    | todo   | spec §5     |

**Exit:** link GitHub, import 2 repos as drafts, edit one and publish it, re-sync it,
and the user's edits survive. Disconnecting deletes the tokens. A real LinkedIn export ZIP previews correctly, and confirming adds only the selected items, with no duplicates on a second import. A malformed or oversized ZIP is rejected with a stable code.

## M8: Utilities

| ID  | Task                                                                                                                                                                 | Repo    | Status  | Source  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------- | ------- |
| 8.1 | Résumé PDF: pick the generator (on the frontend, e.g. `@react-pdf/renderer`, or on the server). Choose sections; one template in v1                                  | fe/api  | todo    | Q10     |
| 8.2 | AI summary: "auto-summarize" from the description or README; provider per Q10; rate-limited; always editable; the feature degrades cleanly when the provider is down | api, fe | stretch | Q10     |
| 8.3 | Tag suggestions from the description                                                                                                                                 | api, fe | stretch | spec §4 |
| 8.4 | Portfolio PDF export                                                                                                                                                 | fe/api  | stretch | spec §7 |
| 8.5 | Share by email (provider, templates, per-user rate limit, abuse controls)                                                                                            | api, fe | stretch | spec §7 |

## M9: Hardening, deployment and v1.0 release

| ID   | Task                                                                                                                                                                                                                                                                                                                     | Repo    | Status | Source      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------ | ----------- |
| 9.1  | Production MySQL on Aiven: TLS with a pinned CA (`DATABASE_SSL=required`), migrations applied on deploy, backup policy checked (export on a schedule if the free tier has none) **Before the first migrate:** diff the baseline against the Aiven database and check its default collation (the term tables inherit it). | ops     | todo   | Q9          |
| 9.2  | Deploy the API (Q9 host): the image from the Dockerfile, env/secrets, `/readyz` as the health check, logs retained, one-command rollback                                                                                                                                                                                 | ops     | todo   | Q9          |
| 9.3  | Deploy the frontend on Vercel: API base URL, `AUTH0_*` (with the audience), storage host; previews point at a non-production API or database                                                                                                                                                                             | ops, fe | todo   | —           |
| 9.4  | Auth0 production settings: callback and logout URLs, branding, email templates, connection secrets (Google/GitHub/LinkedIn)                                                                                                                                                                                              | auth0   | todo   | —           |
| 9.5  | Security pass: every endpoint's second-user 404 test present; XSS corpus; token checks; rate limits; `npm audit` with no exploitable path; secrets out of logs                                                                                                                                                           | all     | todo   | SECURITY.md |
| 9.6  | Frontend E2E (Playwright) of the §8 journey against the preview stack; runs in frontend CI                                                                                                                                                                                                                               | fe      | todo   | spec §8     |
| 9.7  | **Full-system verification** (kit §6.5): a fresh worker drives §8 end to end on the deployed stack from an empty database and records PASS / FAIL / GAP per requirement. It records only; fixes are separate PRs                                                                                                         | all     | todo   | kit         |
| 9.8  | Demo data: realistic students, projects and teams in en/ru/am; a reset script for demos                                                                                                                                                                                                                                  | api     | todo   | —           |
| 9.9  | Docs for handover: README per repo, architecture overview, user guide, demo script; coursework report material if required                                                                                                                                                                                               | all     | todo   | —           |
| 9.10 | Release: tag `v1.0.0` in each repo, freeze scope, changelog, publish the final tracker                                                                                                                                                                                                                                   | all     | todo   | —           |

**Exit:** every 9.7 row PASS, or recorded as an accepted GAP by Levon; production URLs
live; v1.0 tagged.

---

## Issue coverage

Every known defect maps to a task, so nothing is dropped. IDs refer to `issues.md`.

| Issue | Summary                                                                          | Task(s)                |
| ----- | -------------------------------------------------------------------------------- | ---------------------- |
| S1    | `gradfolio-sql` compose crash-loops on a fresh volume                            | 1.11                   |
| S2    | INSERT cannot return a DB-generated id; docs are wrong                           | 1.4, 1.12              |
| S3    | Mark notification read without an owner check                                    | 5.4, 1.13              |
| S4    | Invite without a project-ownership check                                         | 5.1, 1.13              |
| S5    | Project detail ignores `is_public`                                               | 3.1, 4.1, 1.13, Q3     |
| S6    | Skills replace-all with no transaction                                           | 3.4, 1.13              |
| S7    | No CHECK constraints; the API is the only validator                              | 1.5, 1.8               |
| S8    | FULLTEXT ignores words shorter than 3 characters                                 | 6.1                    |
| S9    | `JSON_CONTAINS` is case-sensitive                                                | 1.6, 6.2               |
| S10   | OAuth tokens stored without enforced encryption                                  | 7.2                    |
| S11   | Seed owner-as-member inconsistent                                                | 1.14, 1.10, Q4         |
| S12   | Seed notification links use mock ids                                             | 1.10, 5.4              |
| S13   | Docs say 12 tables; there are 11                                                 | 1.12                   |
| F1    | Regex HTML sanitizer can be bypassed                                             | 4.2, 4.8               |
| F2    | Middleware lets requests through on error                                        | 2.11                   |
| F3    | Current user hardcoded as `u_001`                                                | 2.12                   |
| F4    | Frontend and schema types disagree                                               | Q5, 3.8, 6.5, 2.14     |
| F5    | Image domain allowlist covers mock hosts only                                    | 4.9                    |
| F6    | Frontend docs out of date (Auth0 variable names, `vercel.json`, Next.js version) | 2.15                   |
| P1    | Privacy rules conflict (spec vs schema docs)                                     | Q3                     |
| P2    | Teammates without accounts (schema yes, spec no)                                 | Q4, 5.1                |
| P3    | Spec features with no storage                                                    | 1.7, 6.6               |
| P4    | LinkedIn import may not be possible                                              | Q8 (decided), 7.6–7.10 |

## Follow-ups

Kinds: fix · decide · process. Every deferred review finding becomes a row.

| Source                   | Item                                                                                                                                                                                                                                        | Kind                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| gradfolio Dependabot #15 | `react-resizable-panels` v4 removes or renames `PanelGroup`, `PanelResizeHandle` and the imperative handle types, changes the resize callback and drops `order`. `SideBarWrapper` needs a real rewrite. Dependabot is told not to reopen it | fix (fe)                    |
| gradfolio Dependabot #16 | TypeScript 7 is blocked toolchain-wide: knip requires `typescript <7`, and typescript-eslint caps at `<6.1.0`. Revisit when both support it, in both repos                                                                                  | decide (later)              |
| #9 review (P1)           | Migration DML and its step record run as two autocommits (runner.ts `runStep`). Every current DML step is idempotent, so a re-run converges; still, wrap non-DDL steps in one transaction with the record, and add a test                   | fix (M1 worker)             |
| #10 review               | `review-status.sh`: Codex answers tied to the head; regression tests with a fake `gh`                                                                                                                                                       | fix (orchestrator, this PR) |
| M1 report                | M2 (Q7): upsert = `ON DUPLICATE KEY UPDATE`, then a `FOR SHARE` re-read inside `inTransaction`                                                                                                                                              | decide (M2)                 |
| M1 report                | MySQL 8.4.11: a correlated `EXISTS`/`IN` over `JSON_TABLE` returns wrong results; JSON_TABLE's default `NULL ON ERROR` drops data silently. Both are now in AGENTS.md                                                                       | process                     |
| M1 report                | `canonicalizeTerms` takes locks in sorted order, with no test for it (see m1-verification §10)                                                                                                                                              | process                     |
| 2026-09-29               | Copilot review quota exhausted: every Copilot review since is a quota failure                                                                                                                                                               | decide (Levon)              |
| #6 finding               | probeboard-api's `dev:api` uses tsx, which does not emit decorator metadata. Check whether its dev server injects correctly.                                                                                                                | fix (probeboard)            |
| #6                       | Guard-removal proofs for the skeleton were skipped at Levon's request. Run them when M2 touches the same files.                                                                                                                             | process                     |
| #6                       | The destroy-on-failed-`SET time_zone` path in the pool is untested (it cannot be forced against a real server).                                                                                                                             | process                     |
| 2026-09-28 check         | The production frontend uses a `dev-…` Auth0 tenant; see 2.3                                                                                                                                                                                | decide                      |

## Risks

| Risk                                                                 | Impact                                    | Mitigation                                                                                                                                        |
| -------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| LinkedIn changes its data-export format                              | Import parser breaks                      | Parser keyed on column names from a real export (7.6), with a fixture test; a column it does not recognise is skipped and reported, never guessed |
| Aiven free tier limits (storage, connections, backups)               | Outage or data loss at demo time          | Pool size ≤ plan limit; scheduled export; demo reset script (9.8)                                                                                 |
| Auth0 tenant misconfigured (audience, callbacks) across environments | Logins work but API calls 401             | 2.1–2.4 as a checklist; exit criterion tested on a Vercel preview                                                                                 |
| The frontend has no tests or CI today                                | Wiring regressions go unnoticed           | 0.8 CI, then 9.6 E2E of the §8 journey                                                                                                            |
| Stored rich text becomes an XSS path                                 | Account takeover through a viewed project | Sanitize on write (4.2) + DOMPurify on render (4.8) + bypass corpus tests                                                                         |
| Scope growth from "optional" spec features                           | v1.0 slips                                | The scope table above is the contract; stretch items only after M9 passes                                                                         |
