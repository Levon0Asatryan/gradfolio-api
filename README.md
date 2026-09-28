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
docker compose up -d --build        # MySQL 8.4 + api
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

## Configuration

Every variable is declared in [`src/core/config/schema.ts`](src/core/config/schema.ts)
and validated before anything else is constructed. An invalid or missing value stops
the process at boot, and the error names every offending key.

- `DATABASE_URL` is the only variable with no default.
- In production `DATABASE_SSL=required` is enforced (Aiven requires TLS).

See [`.env.example`](.env.example) for the full list.

## HTTP surface

| Endpoint       | Meaning                                                  | Fails when                                     |
| -------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `GET /healthz` | Liveness: the process is running. Touches no dependency. | the process is dead                            |
| `GET /readyz`  | Readiness: it can serve traffic. Runs `SELECT 1`.        | MySQL is unreachable or too slow, giving `503` |
| `/v1/...`      | Every product route, versioned                           | —                                              |
| `/docs`        | Swagger UI, when `API_DOCS_ENABLED=true`                 | —                                              |

Every failure returns the same shape and never includes internal detail:

```json
{ "code": "NOT_FOUND", "message": "resource not found" }
```

Unmatched routes included. A database outage is `503 DATABASE_UNAVAILABLE` on every
route, not a `500`.

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
