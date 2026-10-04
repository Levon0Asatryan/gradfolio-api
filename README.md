# gradfolio-api

Backend API for **Gradfolio**, a student portfolio platform built as NPUA
university coursework. Gradfolio lets students show their projects, skills and
achievements, each backed by evidence (code, documents, media), to recruiters and
to other students.

| Repo                                                             | Role                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **gradfolio-api** (this repo)                                    | REST API: authentication, profiles, projects, teams, search, integrations |
| [gradfolio](https://github.com/Levon0Asatryan/gradfolio)         | Frontend: Next.js 16, MUI 7, Auth0; hosted on Vercel                      |
| [gradfolio-sql](https://github.com/Levon0Asatryan/gradfolio-sql) | MySQL 8.4 schema, seed data, per-table docs                               |

## Status

**Walking skeleton.** NestJS 12 on Node 24: config validation, structured logging,
MySQL 8.4 pool, health endpoints, a uniform error shape, a generated OpenAPI
document, a container stack, and CI. No product endpoints yet. The remaining
architecture decisions (query layer, schema ownership, privacy model, etc.) are open
in [docs/investigation.md](docs/investigation.md) §6, and progress is tracked in
[docs/tracker.md](docs/tracker.md).

## Quick start

Requires Docker and Node 24 (`nvm use`).

```sh
cp .env.example .env                # compose reads the Auth0 settings from it
docker compose up -d --build        # MySQL 8.4, migrations, then the api
curl localhost:3000/healthz         # {"status":"ok"}
curl localhost:3000/readyz          # {"status":"ok","database":"ok"}
open http://localhost:3000/docs     # Swagger UI
docker compose down -v              # tear down, including the database volume
```

## Local development

Run MySQL in Docker and the API on the host, so restarts are instant:

```sh
cp .env.example .env
docker compose up -d mysql          # host port 3307 (gradfolio-sql's compose uses 3306)
npm ci
npm run migrate                     # bring the database to the latest schema
npm run dev                         # http://localhost:3000, reloads on change
```

| Script                  | Does                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `npm run dev`           | Nest in watch mode, loading `.env`                                    |
| `npm run build`         | Compile to `dist/`                                                    |
| `npm start`             | Run the compiled output                                               |
| `npm run verify`        | Format check, lint, typecheck, OpenAPI check, unit tests (= pre-push) |
| `npm test`              | Unit tests                                                            |
| `npm run test:coverage` | Unit tests with the 90% coverage floor                                |
| `npm run test:int`      | Integration tests against MySQL (`docker compose up -d mysql`)        |
| `npm run openapi`       | Regenerate `openapi.yaml` from the zod schemas                        |
| `npm run migrate`       | Apply pending migrations (`-- --to <name>` to stop at one)            |
| `npm run migrate:down`  | Roll back the latest migration (`-- --all`, or `-- --to <name>`)      |
| `npm run db:schema`     | Print the normalized schema (`SHOW CREATE TABLE`), for diffing        |
| `npm run db:types`      | Regenerate `src/core/db/types.generated.ts` from the migrated schema  |
| `npm run db:seed`       | Load the en/ru/am demo data (not in production; after `migrate`)      |

## Schema and migrations

This repository owns the database schema (decided in `docs/m1-plan.md`, Q2).
`src/core/db/migrations/NNNN_name.up.sql` and `.down.sql`; `0001_baseline` is
gradfolio-sql's `schema.sql` at commit 187ff66.

- MySQL commits DDL implicitly, so a migration is not a transaction. The runner
  records each step (one statement) in `schema_migrations` as soon as it succeeds,
  and a failed run resumes at the failed step.
- Every step must be safe to run twice: `CREATE TABLE IF NOT EXISTS`,
  `DROP TABLE IF EXISTS`, idempotent DML, or a `-- skip-if: <SELECT>` guard line
  before it (MySQL 8.4 has no `IF NOT EXISTS` for columns, indexes or CHECKs). A unit
  test rejects any other step.
- An applied migration is immutable: the runner refuses if a recorded step's SQL
  changed. Write a new migration instead.

## Configuration

Every variable is declared in [`src/core/config/schema.ts`](src/core/config/schema.ts)
and validated before anything else is constructed. An invalid or missing value stops
the process at boot, and the error names every offending key.

- `DATABASE_URL`, `AUTH0_ISSUER_BASE_URL` and `AUTH0_AUDIENCE` have no default
  ([docs/auth0-setup.md](docs/auth0-setup.md)). The database tools (`migrate`,
  `db:seed`, `db:schema`) need only the database settings.
- In production `DATABASE_SSL=required` and an `https:` issuer are enforced.
- `TRUST_PROXY` is `false` or a hop count, never `true`: `true` would believe the
  client-written left-most `X-Forwarded-For` entry.

See [`.env.example`](.env.example) for the full list.

## HTTP surface

| Endpoint       | Meaning                                                  | Fails when                                     |
| -------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `GET /healthz` | Liveness: the process is running. Touches no dependency. | the process is dead                            |
| `GET /readyz`  | Readiness: it can serve traffic. Runs `SELECT 1`.        | MySQL is unreachable or too slow, giving `503` |
| `/v1/...`      | Every product route, versioned; needs a bearer token     | `401` without a valid token                    |
| `/docs`        | Swagger UI, when `API_DOCS_ENABLED=true`                 | —                                              |

Every failure returns the same shape and never includes internal detail:

```json
{ "code": "NOT_FOUND", "message": "resource not found" }
```

Unmatched routes included. A database outage is `503 DATABASE_UNAVAILABLE` on every
route, not a `500`.

**Authentication.** Every route requires `Authorization: Bearer <Auth0 access token>`
unless it is marked `@Public()` (the health routes) or `@OptionalAuth()` (reading a profile: no
token means an anonymous caller who sees public profiles only; a token that is sent but invalid is
still 401). A missing or invalid token is
`401 UNAUTHENTICATED`, the same body whatever the reason; when Auth0's signing keys
cannot be fetched it is `503 AUTH_UNAVAILABLE`.

**Rate limits.** Every route has a per-caller budget (`RATE_LIMIT_DEFAULT` per
`RATE_LIMIT_WINDOW_S`), keyed by the verified user, or by address without a token;
search, import and AI routes add their own. Over budget: `429 RATE_LIMITED` with
`Retry-After`.

## Documentation

| File                                                 | What it holds                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                               | How work is done here, the commands, and the project facts every contributor must know |
| [AGENTS.md](AGENTS.md)                               | Code-review rules: what reviewers (human, Codex, Claude) flag on a pull request        |
| [docs/tracker.md](docs/tracker.md)                   | Status of record: milestones and follow-ups                                            |
| [docs/investigation.md](docs/investigation.md)       | Database and frontend analysis, facts verified against MySQL 8.4, open decisions       |
| [docs/handoff-template.md](docs/handoff-template.md) | Task prompt and report format used between chats                                       |
| [.review/](.review/)                                 | This repo's own review rules, mined from real PR reviews                               |

## Contributing

Read `CLAUDE.md` first. The short version:

- **Never push to `main`.** Work on a branch, open a pull request, and let Levon
  merge it.
- **Keep each change coherent**, and split commits by logical change.
- **Before pushing, run `/gradfolio-review` in Claude Code.** The pre-push hook
  then checks the review receipt (`scripts/require-review.sh`), refuses pushes to
  `main` or to already-merged branches (`scripts/check-branch.sh`), and runs
  `npm run verify`.

- **Every guard needs a test that fails without it.** For authorization, that means
  a test where a second user gets a 404.

### One-time setup

1. Clone next to the other two repos. The docs assume this layout:

   ```
   gradfolio-repos/
   ├── gradfolio-api/
   ├── gradfolio/
   ├── gradfolio-sql/
   └── docs/          product specification (not in any repo)
   ```

2. Log in to GitHub with `gh auth login`, and set your own `git config user.email`.
3. In Claude Code, run `/reload-skills` once so the shared `gradfolio-review` skill
   (`.claude/skills/`) is available.

4. Run `npm ci` once: its `prepare` script installs the git hooks (pre-commit:
   lint-staged, typecheck, unit tests; pre-push: branch check, review receipt,
   verify).
