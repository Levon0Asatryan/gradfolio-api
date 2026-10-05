# Deployment runbook: Cloud Run + Cloud SQL

Design and reasons: [deploy-plan.md](deploy-plan.md). Evidence: [deploy-verification.md](deploy-verification.md).
Every command needs the sandboxed gcloud: `eval "$(direnv export bash)"` and check
`gcloud info --format='value(config.paths.global_config_dir)'` prints
`/Users/levon/Dev/university/.sandbox/gcloud`.

## Where

| Item     | Value                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Project  | `project-33e407b5-7fd5-485d-8dc` (name `gradfolio`), number 1058577031182                                 |
| Region   | `us-east1`                                                                                                |
| API URL  | `https://gradfolio-api-1058577031182.us-east1.run.app`                                                    |
| Frontend | `https://gradfolio-navy.vercel.app` (reads `API_BASE_URL` from Vercel)                                    |
| Reserved | `/healthz` is answered by Cloud Run's front end on `*.run.app` (a Google 404). Use `/readyz` from outside |

## Resources and monthly cost (us-east1, USD, 2026-10-05; plan §1.2 has the unit prices)

| Resource                                        | Setting                                                                              | Monthly                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------- |
| Cloud SQL `gradfolio-db`                        | MySQL 8.4.11, Enterprise, `db-f1-micro`, zonal, private IP only, deletion protection | about $7.67                  |
| Cloud SQL storage                               | 10 GiB SSD, auto-grow capped at 20 GiB                                               | $1.70                        |
| Cloud SQL backups                               | daily 03:00 UTC, 7 kept, no point-in-time recovery                                   | about $0.10                  |
| Cloud Run service `gradfolio-api`               | 1 vCPU, 512 MiB, concurrency 40, **min 1**, max 3                                    | about $9.86 idle + requests  |
| Cloud Run job `gradfolio-migrate`               | same image, seconds per run                                                          | about $0                     |
| Artifact Registry `gradfolio`                   | keeps the 5 newest images                                                            | about $0                     |
| Secret Manager (3 secrets), Logging, VPC egress |                                                                                      | about $0                     |
| **Total (min 1)** / with min 0                  |                                                                                      | **about $19.3** / about $9.5 |

Switch min instances: `gcloud run services update gradfolio-api --region us-east1 --min-instances 0|1`.
The trial credit expires after 90 days; after that the card is billed.

## Environment (no secret values)

| Variable                  | On                                                                                             | Value / source                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | service, job                                                                                   | `production`                                                                                       |
| `LOG_FORMAT`, `LOG_LEVEL` | service, job                                                                                   | `json`, `info`                                                                                     |
| `API_DOCS_ENABLED`        | service                                                                                        | `false`                                                                                            |
| `TRUST_PROXY`             | service                                                                                        | `1` (proved: forged `X-Forwarded-For` ignored)                                                     |
| `DATABASE_SOCKET_PATH`    | service, job                                                                                   | `/cloudsql/project-33e407b5-7fd5-485d-8dc:us-east1:gradfolio-db`                                   |
| `DATABASE_POOL_MAX`       | service                                                                                        | `5`                                                                                                |
| `DATABASE_URL`            | service: **secret** `gradfolio-database-url`; job: **secret** `gradfolio-migrate-database-url` | `mysql://<user>@localhost/gradfolio`, user `gradfolio_app` (DML only) / `gradfolio_migrator` (DDL) |
| `AUTH0_ISSUER_BASE_URL`   | service                                                                                        | the `dev-…us.auth0.com` tenant, trailing slash (production tenant: M9 9.4)                         |
| `AUTH0_AUDIENCE`          | service                                                                                        | `https://api.gradfolio.app`                                                                        |
| `API_BASE_URL`            | Vercel (Production, Preview)                                                                   | the API URL above                                                                                  |

`gradfolio-db-root-password` (secret) is for bootstrap and grants only; nothing at runtime reads it.
Service accounts: `gradfolio-api-run`, `gradfolio-migrate-run` (runtime), `gradfolio-deployer` (CI, via Workload Identity Federation: pool `github`, only repo `Levon0Asatryan/gradfolio-api` on `refs/heads/main`). No key files exist.

## Deploy

Automatic: `deploy.yml` runs after CI succeeds on `main`: build, push `api:<sha>`, run the migrate job, deploy a no-traffic
`candidate`, smoke `/readyz`, shift traffic. Migrations are never run by hand.

A migration must work with the previous release's code (the old revision serves while the new schema is in):
add first, remove one release after the code stops using it.

## Migrate

Nothing to do: the pipeline runs it. To see the last run:
`gcloud run jobs executions list --job gradfolio-migrate --region us-east1`.
A second run prints `migrations: nothing to apply`.

## Roll back

```sh
gcloud run services update-traffic gradfolio-api --region us-east1 --to-revisions <previous-revision>=100
```

List revisions: `gcloud run revisions list --service gradfolio-api --region us-east1`. Return to the newest:
`gcloud run services update-traffic gradfolio-api --region us-east1 --to-latest`. A rollback does not undo a migration.

## Rotate a database password

Per user (`gradfolio_app` with `gradfolio-database-url`; `gradfolio_migrator` with `gradfolio-migrate-database-url`). The value never
leaves the pipe:

```sh
pw=$(openssl rand -hex 24)
gcloud sql users set-password gradfolio_app --instance gradfolio-db --host=% --password="$pw"
printf 'mysql://gradfolio_app:%s@localhost/gradfolio' "$pw" | gcloud secrets versions add gradfolio-database-url --data-file=-
unset pw
gcloud run services update gradfolio-api --region us-east1 --revision-suffix rotated-$(date +%s)   # new revision reads :latest
gcloud secrets versions list gradfolio-database-url   # then: versions disable <old>
```

The migrator needs no restart: each job run reads `:latest`. Check `/readyz` afterwards.

## Budget alert

Billing account `014600-F5EF22-FD7F35`: budget `Cost-Alert`, 10 USD, notifies at 90% and 100%. With min instances 1 the monthly
total (about $19.3) exceeds it: raise it or set min 0. `gcloud billing budgets list --billing-account=014600-F5EF22-FD7F35`.

## Break-glass database access

There is no public IP. Run a one-off Cloud Run job from the same image on the same network and socket
(`--network default --subnet default --vpc-egress private-ranges-only --set-cloudsql-instances ...`), delete it afterwards. Results
print to the job log (JSON lines appear under `jsonPayload`).
