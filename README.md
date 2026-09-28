# gradfolio-api

Backend API for **Gradfolio**, a student portfolio platform built as NPUA
university coursework. Gradfolio lets students show their projects, skills and
achievements, each backed by evidence (code, documents, media), to recruiters and
to other students.

| Repo | Role |
| --- | --- |
| **gradfolio-api** (this repo) | REST API: authentication, profiles, projects, teams, search, integrations |
| [gradfolio](https://github.com/Levon0Asatryan/gradfolio) | Frontend: Next.js 16, MUI 7, Auth0; hosted on Vercel |
| [gradfolio-sql](https://github.com/Levon0Asatryan/gradfolio-sql) | MySQL 8.4 schema, seed data, per-table docs |

## Status

**Pre-architecture: there is no application code yet.** The next milestone, M0,
chooses the stack (Spring Boot or NestJS) and the design decisions listed in
[docs/investigation.md](docs/investigation.md) §6, then builds a walking skeleton.
Progress is tracked in [docs/tracker.md](docs/tracker.md).

## Documentation

| File | What it holds |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | How work is done here, the commands, and the project facts every contributor must know |
| [AGENTS.md](AGENTS.md) | Code-review rules: what reviewers (human, Codex, Claude) flag on a pull request |
| [docs/tracker.md](docs/tracker.md) | Status of record: milestones and follow-ups |
| [docs/investigation.md](docs/investigation.md) | Database and frontend analysis, facts verified against MySQL 8.4, open decisions |
| [docs/handoff-template.md](docs/handoff-template.md) | Task prompt and report format used between chats |
| [.review/](.review/) | This repo's own review rules, mined from real PR reviews |

## Contributing

Read `CLAUDE.md` first. The short version:

- **Never push to `main`.** Work on a branch, open a pull request, and let Levon
  merge it.
- **Keep each change coherent**, and split commits by logical change.
- **Before pushing, run:**
  - `sh scripts/check-branch.sh`, which refuses a push to `main` or to an
    already-merged branch;
  - `/gradfolio-review` in Claude Code, which reviews your change before anyone else
    does.

  `scripts/require-review.sh` checks that review ran. Git hooks will run these
  automatically once M0 sets them up.
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

Build, test and run commands are added to `CLAUDE.md` → "Commands" once M0 picks
the stack.
