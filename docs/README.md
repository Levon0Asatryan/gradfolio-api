# gradfolio-api documentation

This folder holds documentation that belongs **with the code**: it would go out of
date if the code changed and nobody updated it, so it is reviewed in the same pull
request as the change that affects it.

| Document                                   | Covers                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| [../README.md](../README.md)               | Running, developing, configuring, the layout and its rules                 |
| [tracker.md](tracker.md)                   | Status of every milestone, PR and follow-up. Read it first.                |
| [investigation.md](investigation.md)       | Database and frontend analysis, facts verified on MySQL 8.4, decisions Q1–Q10 |
| [handoff-template.md](handoff-template.md) | How work is handed to a worker chat and reported back                      |
| [../openapi.yaml](../openapi.yaml)         | The API surface, generated from the zod schemas                            |
| `mN-plan.md`                               | The investigation and plan each milestone was built from                   |
| `mN-verification.md`                       | What was run to accept each milestone, and what it produced                |

## What is not here

| Looking for                            | Go to                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Product scope and features             | The feature specification, in the workspace `docs/` folder (not in any repository)                               |
| Table definitions, per-column docs     | [gradfolio-sql](https://github.com/Levon0Asatryan/gradfolio-sql) `docs/`                                         |
| Frontend pages and types               | [gradfolio](https://github.com/Levon0Asatryan/gradfolio) `CLAUDE.md`                                             |
| Known defects across all three repos   | `issues.md` in the workspace root                                                                                |

## Adding a document here

Add a document here only if both are true:

- it answers _how_, for someone who has this repository checked out;
- it would be wrong if the code changed without it.

Reference material (API endpoints, database schema) should be **generated** from the
code rather than written by hand, so it cannot drift.

`openapi.yaml` is the worked example:

- `npm run openapi` builds it from the same zod schemas that the request pipeline
  validates against;
- CI fails if the committed file is out of date;
- a test compares it against Nest's own route metadata in both directions, so neither
  an undocumented endpoint nor a documented one that doesn't exist can survive.

Setting `API_DOCS_ENABLED=true` serves the same document as Swagger UI at `/docs`.
`docker compose` sets it.
