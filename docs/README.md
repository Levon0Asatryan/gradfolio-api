# gradfolio-api documentation

This folder holds documentation that belongs **with the code**: it would go out of
date if the code changed and nobody updated it, so it is reviewed in the same pull
request as the change that affects it.

The folders, from the top:

| Where                              | What it holds                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [tracker.md](tracker.md)           | **The general plan.** Status of every milestone, decision, PR and follow-up. Read it first.                                                                                                      |
| [modules/](modules/README.md)      | **One folder per module** (M1–M9, deploy, UI): its plan, verification and, from M8 on, task briefs. Also how the three levels of chats work.                                                     |
| [ops/](ops/)                       | Running the system: the [deploy runbook](ops/deploy.md) and the [Auth0 tenant checklist](ops/auth0-setup.md)                                                                                     |
| [process/](process/)               | How work is done: the [handoff template](process/handoff-template.md) and [every prompt and report](process/handoffs/README.md)                                                                  |
| [reference/](reference/)           | Background that doesn't change per milestone: the [investigation](reference/investigation.md), [known defects](reference/issues.md), the [product spec and competitor analysis](reference/spec/) |
| [course/](course/)                 | Coursework: how the project is split between the three students (Armenian)                                                                                                                       |
| [../README.md](../README.md)       | Running, developing, configuring, the layout and its rules                                                                                                                                       |
| [../openapi.yaml](../openapi.yaml) | The API surface, generated from the zod schemas                                                                                                                                                  |

M7's plan and production-run documents are still at `docs/m7-plan.md` and
`docs/m7-prod-run.md` while M7 is in progress.

## What is not here

| Looking for                        | Go to                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Table definitions, per-column docs | [gradfolio-sql](https://github.com/Levon0Asatryan/gradfolio-sql) `docs/` |
| Frontend pages and types           | [gradfolio](https://github.com/Levon0Asatryan/gradfolio) `CLAUDE.md`     |

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
