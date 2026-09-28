# Gradfolio — pre-architecture investigation

Date: 2026-09-28. Input to the backend architecture decision (M0).

Sources read:

- `gradfolio-sql` — `sql/schema.sql`, `seed.sql`, `queries.sql`, `drop.sql`,
  `docker-compose.yml`, `docs/TABLES.md`, `docs/01…11-*.md`, the ERD image.
- `gradfolio` (frontend) — `src/` (types, mocks, auth, pages), `CLAUDE.md`, `README.md`.
  It has no `docs/` folder.
- Product spec — `gradfolio-repos/docs/Student Portfolio Management System – Feature
  Specification.md` and the competitor analysis next to it. They are not in any repo.

Rows marked **run** were executed against MySQL 8.4.11 in a throwaway container,
which was stopped and removed afterwards with no volumes left behind.

---

## 1. The three repos

| Repo | State |
| --- | --- |
| `gradfolio` | Next.js 16, React 19, MUI 7, Auth0 v4. About 9.8k lines of TypeScript. **All data is mock:** no API calls and no tests. Deployed on Vercel. |
| `gradfolio-sql` | MySQL 8.4 schema with 11 tables, plus seed data, example queries and per-table docs. Hosted on Aiven's free tier (1 GB). |
| `gradfolio-backend` | This repo. It is empty. |

## 2. Scope, from the spec

| Priority | Features |
| --- | --- |
| Core | Auth (email/password plus Google, LinkedIn and GitHub OAuth via Auth0); profile page with education, experience, projects, certifications and skills, plus an edit mode; project pages (description, attachments, tech tags, team, metadata); search and browse; teammate tagging with confirmation; notifications for team invites. |
| Core, harder | GitHub import (list repos, pick some, import metadata and README). LinkedIn import. The LinkedIn API gives third-party apps very limited profile data; check this before promising the feature. |
| Utilities | Resume PDF, portfolio PDF, sharing by email, AI-generated summaries and tag suggestions. |
| Optional ("can be skipped") | Email and phone OTP verification; verifying education, certifications and projects; admin interface. |
| Future | Comments, endorsements, follow and bookmark, "similar projects". |

Things the spec says that the architecture has to respect:

- §7 proposes **Next.js + Java Spring Boot**. That is **not decided**: NestJS is the
  alternative (see Q1).
- The spec says a private project is "visible only via direct link or to logged-in
  users", and that search and browse show public content only.
- On teammates, the spec says they are added "provided those teammates also have
  accounts". The schema also allows teammates without an account (`user_id` NULL).
- The spec expects "cloud storage for files".
- The spec says external APIs are called "on the back-end for security".
- The spec treats AI as an enhancement, "not core to functioning if the API is
  unavailable".

Spec features that have **no storage in the schema**:

- view counts (needed for "most viewed" sorting);
- verification state for education, certifications and projects, and the uploaded
  verification documents;
- endorsements, comments, bookmarks and follows;
- GitHub stars and forks.

Browsing users "by school, major, graduation year" can be derived from
`education.institution`, `education.field` and `education.end_year`.

## 3. The database

### 3.1 Shape

There are 11 tables. The docs say 12, but `schema.sql` has 11 `CREATE TABLE` statements.

```
users (auth0_id UNIQUE, is_public, FULLTEXT name+headline)
├── education, experience, certifications, user_skills   profile sections, sort_order
├── projects (is_public, category/status ENUM, JSON tags/technologies/links/files,
│   │         repo_* + meta_* inline, FULLTEXT title+summary+ai_summary)
│   ├── project_attachments   image|video|pdf|link, sort_order
│   └── project_team_members  user_id NULLABLE, status pending|accepted|rejected,
│                             UNIQUE(project_id,user_id), FK user → SET NULL
├── integrations  UNIQUE(user_id,integration_type); access/refresh tokens as TEXT
├── activities    i18n key + JSON params (the frontend renders the text)
└── notifications polymorphic reference_id/reference_type, precomputed link
```

Conventions:

- Primary keys are `CHAR(36) DEFAULT (UUID())`.
- Columns are snake_case; the API converts them to camelCase.
- Booleans are `TINYINT(1)`.
- Timestamps are `DATETIME`.
- Every foreign key is `ON DELETE CASCADE`, except team member → user, which is
  `SET NULL`.
- The character set is utf8mb4.

### 3.2 Facts verified by running (**run**)

| # | Finding | What it means for the backend |
| --- | --- | --- |
| D1 | An INSERT that omits `id` leaves `LAST_INSERT_ID()` at 0, so **the API cannot learn the new row's id**. The docs say "inserts must omit id". The schema comment says "GENERATED ALWAYS", which is wrong: it is a plain DEFAULT. The seed itself supplies ids with `SET @x = UUID()`. | The backend generates UUIDs and inserts them itself. The docs need correcting. |
| D2 | `UUID()` returns version 1 UUIDs, which are built from a timestamp and a node id. | Ids reveal when a row was created. That is harmless here, and app-side UUIDs avoid it. |
| D3 | FULLTEXT ignores words shorter than 3 characters (`innodb_ft_min_token_size=3`). `ML`, `AI`, `Go`, `UI` and `C#` return 0 hits. Armenian text matches correctly. | Short search terms need a fallback (a tag or `LIKE` match), or we accept the gap. |
| D4 | `JSON_CONTAINS(technologies,'"react"')` returns 0 rows when the stored value is `React`. | Tag search and clickable tags must normalise case. |
| D5 | There are no CHECK constraints. `tags` accepts `{"a":1}` and `certifications.date` accepts `banana`. | The API is the only thing validating JSON shapes and `YYYY-MM` strings. |
| D6 | UNIQUE(project_id,user_id) stops a linked user being added twice to a project. Several rows with `user_id` NULL (external teammates) are allowed. | Re-inviting someone after `rejected` must be an UPDATE, not an INSERT. |
| D7 | The seed is inconsistent about the owner: 2 projects have a team-member row for their owner and 2 do not. | Needs a decision; see Q4. |
| D8 | `sql_mode` includes `ONLY_FULL_GROUP_BY` and `STRICT_TRANS_TABLES`. `time_zone` is `SYSTEM`. | The backend should set the session `time_zone` to `+00:00`, because DATETIME stores no time zone. |
| D9 | **The local Docker setup fails on a fresh volume.** The compose file mounts all of `sql/` into `docker-entrypoint-initdb.d`, and MySQL runs those files alphabetically: `drop.sql`, then `queries.sql`, which fails with `ERROR 1146 Table 'gradfolio.users' doesn't exist`. The container then restarts in a loop. | Fix it in `gradfolio-sql`: mount only the schema and seed, or rename them `01-`/`02-`. Backend tests must not depend on that compose file as it is. |

### 3.3 Defects in `queries.sql`, the draft of the API's SQL

- **7c** `UPDATE notifications SET is_read=1 WHERE id=@nid` has no `user_id` check,
  so any user can mark anyone's notification as read.
- **2a–2c** Project detail ignores `is_public`. See Q3 for the privacy decision.
- **8a** Inviting a teammate does not check that the caller owns the project.
- **10e** "Replace all skills" (a DELETE followed by INSERTs) must run in one transaction.
- The seed's notifications link to `/projects/proj_001`, which is a mock id, so the
  links are broken.

### 3.4 Security-relevant columns

- `integrations.access_token` and `refresh_token`: the docs require encryption in the
  application before storing them. Nothing enforces that. The API must never return them.
- `projects.description_html` is stored HTML that the frontend renders with
  `dangerouslySetInnerHTML`.
- `users.birthday` and `phone` are "not displayed publicly", according to the docs.
  Public profile responses must leave them out.

## 4. The frontend

### 4.1 What it needs from the API (from its pages and mocks)

| Page | Data shown | API it needs |
| --- | --- | --- |
| `/` dashboard | Own profile header, stats, 4 recent projects, activity feed | Dashboard read |
| `/profile/[id]` | Full profile, including accepted team projects; inline editing on your own profile | Profile read, profile update, create/update/delete per section, reordering |
| `/projects` | Own projects; search, category filter and sort happen in the browser | List own projects |
| `/projects/[id]` | Detail, attachments, accepted team members, metadata | Project read |
| `/projects/new` | Title, AI summary, demo URL, repo URL, attachments (URLs only) | Project create |
| `/search` | Portfolios matched by name, headline, skills and projects; category heuristic | Search |
| `/integrations`, onboarding stepper | Connect or disconnect GitHub and LinkedIn; import | OAuth and import, in a later milestone |
| — | Notifications: the table exists, but there is **no UI** | The API can come first; the UI later |

### 4.2 Auth

- The frontend uses `@auth0/nextjs-auth0` v4 with `authorizationParameters.audience`
  set, which means it is already configured to get **access tokens for an API**. The
  natural contract:
  - the Next.js server calls the backend with `Authorization: Bearer <JWT>`;
  - the backend checks the token's issuer, audience and signature against Auth0's
    published keys (JWKS);
  - the token's `sub` maps to `users.auth0_id`.
- The current user is hardcoded as `u_001` in 3 places: `profile/page.tsx`,
  `profile/[id]/page.tsx` and `AppNavigation.tsx`.
- `middleware.ts` catches every error and returns `undefined`, so a failure lets the
  request through.
- *Not verified:* the frontend CLAUDE.md says the middleware "protects all routes". In
  v4, `auth0.middleware` mounts the `/auth/*` routes and refreshes sessions; it does not
  by itself require a login. Check this when wiring the frontend to the API.

### 4.3 Where frontend types and the schema disagree (the API has to bridge these)

| Frontend | Database | Note |
| --- | --- | --- |
| Profile-level `Project` has `name` and a `category` with 4 values | `projects.title`; ENUM with 6 values | Rename the field and widen the frontend type |
| `ProfileData.avatarUrl: string` is required | Column is nullable | Needs a default or fallback |
| `ProjectDetailData.aiSummary` and `descriptionHtml` are required | Columns are nullable | Return `""` or make them optional |
| `socialLinks` has `github`, `linkedin`, `twitter` | Table also has `website`, `bio`, `phone`, `birthday` | `website` and `bio` are missing from the profile type |
| `TeamMember.profileUrl` | Derived from `user_id` | The API computes it |
| `DashboardStats.githubStars`, `linkedinConnections` | **No column anywhere** | Drop them, or add storage for them |
| `Integration.id` is `"github"` | `integration_type` plus a UUID `id` | The API maps between them |
| Search categories ("Developers", "Designers"…) | Nothing | A keyword heuristic |
| Onboarding stepper has free-text `experience`, `education` and `repos` fields | Structured tables | The stepper needs redesigning when it is wired up |
| Mock ids such as `u_001` and `ecoroute` | UUIDs | Routes will use UUIDs |
| — | `notifications` | No frontend type yet |

### 4.4 Security notes

- `ProjectDescription.tsx` cleans HTML with regular expressions: it strips
  `script`/`style`, `on*=` attributes and quoted `javascript:` URLs. That can be bypassed
  with entity-encoded `javascript:`, unquoted schemes, `srcdoc` or SVG. **The backend
  must sanitize `description_html` when it is saved, using an allow-list sanitizer.** The
  frontend's cleaning stays as a second layer.
- `next.config.ts` allows images only from pravatar and unsplash, so user-uploaded
  images will not render through `next/image` until file storage is decided.
- GitHub README import means the server fetches URLs, which is a potential SSRF risk.
  Fetch only through the GitHub API, never from a URL the user supplies.

### 4.5 Where the frontend docs are out of date

- CLAUDE.md says there are 10 tables.
- CLAUDE.md lists the v3 environment variable names (`AUTH0_BASE_URL`,
  `AUTH0_ISSUER_BASE_URL`); the README uses the v4 names (`APP_BASE_URL`,
  `AUTH0_DOMAIN`).
- CLAUDE.md says a `vercel.json` returns 503; there is no `vercel.json`.
- The README says Next.js 15; `package.json` has 16.

## 5. Scale and constraints

- Real scale: tens of users and hundreds of projects, on Aiven's free MySQL (1 GB).
  Anything that only pays off at larger scale is out of scope.
- The frontend is on Vercel. Wherever the backend is hosted, it must reach Aiven over TLS.
- None of the three repos has test infrastructure yet.

## 6. Decisions for the architecture milestone (M0)

| # | Question | Why it matters |
| --- | --- | --- |
| Q1 | **Stack: Spring Boot (Java) or NestJS (TypeScript)?** The spec says Spring Boot; NestJS keeps one language across frontend and backend and allows sharing types. Also choose how the code talks to the database: a query builder or an ORM, given the MySQL features in play (`ON DUPLICATE KEY`, JSON columns, FULLTEXT). | Decides the build, test and gate commands in `CLAUDE.md`, the git hooks and the review skill. |
| Q2 | **Who owns the schema?** Either `gradfolio-sql` stays the source of truth, or the backend takes over with versioned migrations (Flyway/Liquibase, or a TS migrator) that each have a down step. | Today there is no migration path: a schema change means re-running `schema.sql`. |
| Q3 | **Privacy:** can a private project or profile be read by direct link (the docs), only by logged-in users (the spec), or only by its owner (404 for everyone else)? | Every read path depends on it. |
| Q4 | **Is the owner an implicit team member, or always a team-member row (D7)?** Can teammates exist without an account (schema yes, spec no)? | The team list, and whether a project appears on a teammate's profile. |
| Q5 | **How do frontend and API share types?** An OpenAPI spec that generates a TypeScript client, or types kept by hand. | Covers the mismatches in §4.3. |
| Q6 | **Where are files stored?** Vercel Blob, S3, R2, or external URLs only. | Attachments, avatars and verification documents. |
| Q7 | **When is a `users` row created?** Probably on the first authenticated request. Two first requests can race on the `auth0_id` UNIQUE key, so use an upsert. | Resolving the caller's identity on every request. |
| Q8 | **Integrations scope:** real GitHub OAuth and import now, or later? LinkedIn import may not be possible with its API. | Token encryption, the SSRF risk, and milestone order. |
| Q9 | **Where does the backend run** (Render, Fly, Railway…), and how do integration tests get MySQL 8.4 (Testcontainers or compose)? | The real-run and CI commands. |
| Q10 | **How do AI summaries, PDF generation and email work?** Which providers, and do they run in the request or in a background job? | Whether the backend needs a worker process. |

## 7. Follow-ups for the other repos

| Repo | Item |
| --- | --- |
| gradfolio-sql | D9: fresh `docker compose up` fails on the first boot (`queries.sql` runs before `schema.sql`). |
| gradfolio-sql | Docs say 12 tables; there are 11. The schema comment says "GENERATED ALWAYS" but the column uses a plain DEFAULT. "Inserts must omit id" contradicts D1 and the seed. |
| gradfolio-sql | `queries.sql` 7c (no owner check), 2a–2c (`is_public` ignored), 8a (no project ownership check). |
| gradfolio-sql | Seed notification links use mock ids (`/projects/proj_001`). |
| gradfolio | `middleware.ts` lets requests through when it errors; the regex HTML sanitizer can be bypassed; out-of-date docs (§4.5). |
