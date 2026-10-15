# Issues

The main findings from the pre-architecture investigation. Evidence and details are in
[gradfolio-api/docs/investigation.md](gradfolio-api/docs/investigation.md). "Run" means reproduced against MySQL
8.4.11.

Severity:

- **high**: a security hole, lost data, or something that blocks development;
- **medium**: a wrong result, or a contract the backend must enforce;
- **low**: out-of-date docs or tidy-up.

## gradfolio-sql

| #   | Severity | Issue                                                                                                                                                                                                                     | Evidence                                                | Fix                                                                                                            |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| S1  | high     | A fresh `docker compose up` fails. The compose file mounts all of `sql/` into the init folder, and MySQL runs the files alphabetically, so `queries.sql` runs before `schema.sql`. The container then restarts in a loop. | run: `ERROR 1146 Table 'gradfolio.users' doesn't exist` | Mount only the schema and seed, or rename them `01-schema.sql` and `02-seed.sql` and move the other files out. |
| S2  | high     | An INSERT that omits `id` cannot return the new id, because `LAST_INSERT_ID()` is 0. The docs say "inserts must omit id". The schema comment says "GENERATED ALWAYS", but the column uses a plain DEFAULT.                | run                                                     | The backend generates UUIDs itself. Correct the docs and the comment.                                          |
| S3  | high     | `queries.sql` 7c marks a notification as read by `id` alone, so any user can change anyone's notification.                                                                                                                | read                                                    | Add `AND user_id = ?`.                                                                                         |
| S4  | high     | `queries.sql` 8a adds a teammate without checking that the caller owns the project.                                                                                                                                       | read                                                    | Check ownership before inserting.                                                                              |
| S5  | medium   | `queries.sql` 2a–2c (project detail) ignore `is_public`.                                                                                                                                                                  | read                                                    | Enforce the privacy rule once it is decided (Q3).                                                              |
| S6  | medium   | "Replace all skills" (10e) is a DELETE followed by INSERTs with no transaction.                                                                                                                                           | read                                                    | Run it as one transaction.                                                                                     |
| S7  | medium   | There are no CHECK constraints. JSON arrays accept objects, and `YYYY-MM` columns accept `banana`.                                                                                                                        | run                                                     | The API validates. CHECK constraints are optional.                                                             |
| S8  | medium   | FULLTEXT ignores words shorter than 3 characters (`ML`, `AI`, `Go`, `UI`, `C#`).                                                                                                                                          | run                                                     | Add a fallback match on tags or skills.                                                                        |
| S9  | medium   | `JSON_CONTAINS` is case-sensitive: `react` does not match `React`.                                                                                                                                                        | run                                                     | Normalise tag case when saving and when searching.                                                             |
| S10 | medium   | OAuth tokens are stored in TEXT columns with nothing enforcing encryption.                                                                                                                                                | read                                                    | The backend encrypts them before saving and never returns them.                                                |
| S11 | low      | The seed is inconsistent about the owner: 2 projects have a team-member row for their owner and 2 do not.                                                                                                                 | run                                                     | Decide the rule (Q4) and fix the seed.                                                                         |
| S12 | low      | The seed's notification links use mock ids (`/projects/proj_001`).                                                                                                                                                        | read                                                    | Build the links from the real `@proj` UUIDs.                                                                   |
| S13 | low      | The docs say 12 tables; there are 11.                                                                                                                                                                                     | read                                                    | Correct the docs.                                                                                              |

## gradfolio (frontend)

| #   | Severity | Issue                                                                                                                                                                                       | Evidence | Fix                                                                                                           |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| F1  | high     | `ProjectDescription.tsx` cleans HTML with regular expressions that can be bypassed (entity-encoded `javascript:`, `srcdoc`, SVG). The HTML is then rendered with `dangerouslySetInnerHTML`. | read     | The backend sanitizes with an allow-list when the HTML is saved. Replace the frontend cleaner with DOMPurify. |
| F2  | medium   | `middleware.ts` catches every error and returns `undefined`, so a failure lets the request through.                                                                                         | read     | Fail closed on errors.                                                                                        |
| F3  | medium   | The current user is hardcoded as `u_001` in 3 files.                                                                                                                                        | read     | Take the user from the Auth0 session when wiring to the API.                                                  |
| F4  | medium   | Frontend types and the schema disagree: `name` vs `title`, a 4-value category vs 6 values, required vs nullable fields, and `githubStars`/`linkedinConnections` have no column anywhere.    | read     | Decide on an API contract and generated types (Q5).                                                           |
| F5  | low      | The image domain allowlist only covers mock hosts, so uploaded images will not render.                                                                                                      | read     | Update it once file storage is chosen (Q6).                                                                   |
| F6  | low      | Docs are out of date: 10 tables, Auth0 v3 environment variable names, a missing `vercel.json`, and "Next.js 15".                                                                            | read     | Correct CLAUDE.md and README.                                                                                 |

## Spec vs schema

| #   | Severity | Issue                                                                                                                                                                                                                    | Fix                                                                                                                              |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| P1  | medium   | Privacy rules conflict: the spec says private means "direct link or logged-in users", and the schema docs say "direct link only".                                                                                        | Decide Q3.                                                                                                                       |
| P2  | medium   | The spec requires teammates to have accounts; the schema allows teammates without one.                                                                                                                                   | Decide Q4.                                                                                                                       |
| P3  | low      | Several spec features have no storage: view counts ("most viewed"), verification state and documents, endorsements, comments, bookmarks, and GitHub stars.                                                               | Add them per milestone, only for features in scope.                                                                              |
| P4  | low      | LinkedIn profile import: **confirmed impossible via the API** (2026-09-28). Its only open permissions are sign-in (name, headline, photo, email); positions, education, skills and certifications need partner programs. | Import from the member's own LinkedIn data export (ZIP upload → preview → confirm), plus sign-in pre-fill. Tracker Q8, 7.6–7.10. |

## Open decisions (M0)

Details are in [investigation §6](gradfolio-api/docs/investigation.md#6-decisions-for-the-architecture-milestone-m0).

- **Q1** Stack: Spring Boot or NestJS, plus the database access layer.
- **Q2** Who owns the schema, and how migrations work.
- **Q3** Privacy rules.
- **Q4** Owner and teammate model.
- **Q5** API contract and type sharing.
- **Q6** File storage.
- **Q7** When the user row is created (race-safe upsert).
- **Q8** Integrations scope.
- **Q9** Hosting, and MySQL for tests.
- **Q10** AI summaries, PDF generation and email: providers, and whether a background worker is needed.
