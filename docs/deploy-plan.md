# Deployment plan: the API on Google Cloud (Cloud Run + Cloud SQL)

Status: **plan, awaiting Levon's approval.** No billed resource exists yet.
Scope: a minimal production deployment ahead of M9. Covers tracker 9.1 (database), 9.2
(API host) and the API half of 9.3. Q9 is answered by this plan. The production Auth0
tenant (9.4), the security pass, the full verification and demo data stay in M9.

Decided by Levon (2026-10-05): Docker on Cloud Run; project
`project-33e407b5-7fd5-485d-8dc` (name `gradfolio`); region **`us-east1`**; Cloud SQL
MySQL 8.4; Aiven abandoned, production starts empty.

## 1. Investigation

### 1.1 Availability (run on 2026-10-05, `gcloud` in the sandbox)

| Check                                                                        | Result                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `gcloud sql flags list --database-version=MYSQL_8_4`                         | `MYSQL_8_4` is a valid version (flags `sql_mode`, `collation_server`, `default_time_zone`). |
| `gcloud sql tiers list`                                                      | `db-f1-micro` (614 MiB) and `db-g1-small` are offered in `us-east1`.                        |
| Billing                                                                      | `billingEnabled: true` on the project.                                                      |
| Minor version                                                                | 8.4.11 is Cloud SQL's current default (Levon, same as CI). Re-checked after creation (§8).  |
| APIs enabled so far (free): `sqladmin`, `cloudbilling`. Nothing else exists. |                                                                                             |

`db-f1-micro` exists only in the **Enterprise** edition: create with `--edition=ENTERPRISE`.
The 8.4 minor cannot be read before an instance exists; if the created instance is not
8.4.11 the work stops and reports (the two MySQL bugs in AGENTS.md were checked on it).

### 1.2 Prices (us-east1, USD, read from the Cloud Billing Catalog API on 2026-10-05)

Live pages: [Cloud SQL](https://cloud.google.com/sql/pricing),
[Cloud Run](https://cloud.google.com/run/pricing),
[Artifact Registry](https://cloud.google.com/artifact-registry/pricing),
[Secret Manager](https://cloud.google.com/secret-manager/pricing).
The pages did not render for our fetcher, so the numbers come from
`cloudbilling.googleapis.com/v1/services/<id>/skus`; re-check them on the pages.

| Item                                 | Unit price                               | Notes                                                       |
| ------------------------------------ | ---------------------------------------- | ----------------------------------------------------------- |
| Cloud SQL MySQL `db-f1-micro`, zonal | **$0.0105 / h** (about $7.67 / mo)       | `db-g1-small` is $0.035 / h (about $25.55 / mo)             |
| Cloud SQL standard (SSD) storage     | **$0.17 / GiB-mo**                       | 10 GiB minimum, auto-grow capped (§2)                       |
| Cloud SQL public IPv4                | $0.01 / h (about $7.30 / mo)             | avoided by private IP (§3)                                  |
| Cloud SQL backup storage             | not found in the catalog                 | documented around $0.08 / GiB-mo; a few MiB of data: cents  |
| Cloud Run CPU, request-based         | $0.000024 / vCPU-s                       | free tier 180,000 vCPU-s / mo (Cloud Run docs, not catalog) |
| Cloud Run memory, request-based      | $0.0000025 / GiB-s                       | free tier 360,000 GiB-s / mo (same)                         |
| Cloud Run requests                   | $0.40 / million after 2 M free           |                                                             |
| Cloud Run min-instance idle CPU      | $0.0000025 / vCPU-s                      | only when min instances is 1                                |
| Cloud Run min-instance idle memory   | $0.0000025 / GiB-s                       | same                                                        |
| Cloud Run jobs                       | CPU $0.000018 / s, mem $0.000002 / GiB-s | a migrate run lasts seconds: well under a cent              |
| Artifact Registry storage            | $0.10 / GiB-mo after 0.5 GiB free        | one image about 150 MB; cleanup keeps the last 5            |
| Secret Manager                       | free up to 6 active versions             | we use 2 secrets, 2 versions each                           |
| Direct VPC egress, PSA peering       | no charge for the feature                | only network egress, near zero here                         |

### 1.3 The `/cloudsql` socket with our driver (run)

mysql2 3.24.4 (pinned): `new ConnectionConfig({ uri, socketPath })` keeps the URL's
user, password (percent-decoded) and database, and `socketPath` takes the place of
host and port. So the URL stays the single source of credentials; the socket only
replaces the transport.

### 1.4 `TRUST_PROXY` for Cloud Run

Cloud Run's front end appends the connecting address to `X-Forwarded-For`; the
connecting peer is Vercel's server egress. **Expected: `TRUST_PROXY=1`** (one hop,
never `true`). Not assumed: Phase 3 proves it by sending more than `RATE_LIMIT_DEFAULT`
anonymous requests, each with a different forged `X-Forwarded-For`. A 429 shows the
forgery is ignored (hop count right); no 429 means the count is too high (the
left-most forgeable entry was used) and it is lowered. Every Vercel server call shares
Vercel's egress address when anonymous: known follow-up (M6), not new.

### 1.5 What `main` already gives us

- The image: multi-stage, non-root, `CMD node dist/api/main.js`, port 3000. The same
  image runs `node dist/core/db/migrator/cli.js up` and
  `node dist/core/db/migrator/dump-cli.js`: no second image.
- `/healthz` and `/readyz` exist. SIGTERM closes the pool (`enableShutdownHooks`).
- `loadDatabaseConfig()` needs only database settings, so the migrate job has no Auth0
  variables.

### 1.6 Collation, `sql_mode`, `time_zone` (what M1 relies on)

| Setting     | M1 relies on                                                                     | Cloud SQL 8.4 default (to verify after creation) | Action                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| collation   | `utf8mb4_unicode_ci` (term tables inherit it; compose sets `--collation-server`) | server default is MySQL's `utf8mb4_0900_ai_ci`   | flags `character_set_server=utf8mb4`, `collation_server=utf8mb4_unicode_ci`, and `CREATE DATABASE ... COLLATE utf8mb4_unicode_ci` |
| `sql_mode`  | MySQL default, plus mysql2's session `IGNORE_SPACE`                              | MySQL 8.4 default (strict)                       | none; `SELECT @@sql_mode` compared in Phase 3                                                                                     |
| `time_zone` | session pinned to `+00:00` on every connection                                   | `SYSTEM` = UTC                                   | none; the pool pins it anyway                                                                                                     |

The collation and baseline are verified by the dump-and-diff method of m1-verification,
through all current migrations (Phase 3, item 2).

## 2. Resources

| Resource           | Name / setting                                                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud SQL instance | `gradfolio-db`, MySQL 8.4, `ENTERPRISE`, `db-f1-micro`, zonal, `us-east1`, 10 GiB SSD, auto-grow **on, capped at 20 GiB**, automated backups daily + 7 retained, point-in-time recovery **off** (binlog costs storage; daily backup is enough for coursework), deletion protection **on** |
| Database           | `gradfolio`, `utf8mb4` / `utf8mb4_unicode_ci`                                                                                                                                                                                                                                             |
| DB users           | `gradfolio_app`: `SELECT, INSERT, UPDATE, DELETE` on `gradfolio.*`. `gradfolio_migrator`: all privileges on `gradfolio.*` except `GRANT OPTION`. No root use after setup                                                                                                                  |
| Artifact Registry  | Docker repo `gradfolio` in `us-east1`; cleanup policy keeps the 5 newest                                                                                                                                                                                                                  |
| Cloud Run service  | `gradfolio-api` (see §4)                                                                                                                                                                                                                                                                  |
| Cloud Run job      | `gradfolio-migrate`, same image, runs `node dist/core/db/migrator/cli.js up`                                                                                                                                                                                                              |
| Secret Manager     | `gradfolio-database-url`, `gradfolio-migrate-database-url`                                                                                                                                                                                                                                |
| Service accounts   | `gradfolio-api-run` (runtime, `cloudsql.client`, `secretmanager.secretAccessor` on its own secret), `gradfolio-migrate-run` (same, on the migrator secret), `gradfolio-deployer` (CI, §6)                                                                                                 |

The two DB users keep the running API from ever holding DDL rights: a SQL-injection or
a bug in the app cannot drop tables. Migrations are the only DDL path.

## 3. The connection

### 3.1 Private connectivity (recommended)

Cloud SQL **private IP only** (no public IPv4, so no $7.30 / mo and no internet-facing
database port) through Private Service Access on the project's `default` network. Cloud
Run and the job use **Direct VPC egress** (`--network default --subnet default
--vpc-egress private-ranges-only`) and Cloud Run's built-in Cloud SQL connection
(`--add-cloudsql-instances`), which exposes `/cloudsql/<connection name>`.
Costs nothing extra.

Trade-off: no laptop access to the database (there is no public IP). Admin checks run as
a Cloud Run job from the same image (`dump-cli.js`, or a `node -e` query) with the
migrator secret. **Fallback** if Direct VPC egress misbehaves: public IPv4 with _no_
authorized networks (the connector is the only way in), at +$7.30 / mo.

### 3.2 Code change: `DATABASE_SOCKET_PATH` (small PR, Phase 2)

- Schema (`src/core/config/schema.ts`): `DATABASE_SOCKET_PATH`, optional. Validated:
  absolute path, no NUL byte, no whitespace, at most 107 bytes (the `sun_path` limit).
- `DATABASE_URL` keeps carrying user, password and database; its host and port are
  ignored when the socket is set (a placeholder host such as `localhost` is fine).
- `poolOptions` (`src/core/db/pool.ts`) adds `socketPath`. `loadDatabaseConfig()` and the
  api config both include it, so the migrate job uses the same path.
- `.env.example`, `docs/deploy.md` and the compose comment describe it.

### 3.3 The TLS rule

Today: production requires `DATABASE_SSL=required`. A Unix socket is not a network
connection: the connector's own encrypted tunnel (IAM-authorized, mTLS to the instance)
carries the traffic, and the server does not offer TLS on the socket, so
`DATABASE_SSL=required` would make the connection **fail**. New rule, deliberate:

| `NODE_ENV`     | `DATABASE_SOCKET_PATH` | `DATABASE_SSL`  | Result                                                    |
| -------------- | ---------------------- | --------------- | --------------------------------------------------------- |
| production     | unset                  | `required`      | ok (a TCP database such as another host, as today)        |
| production     | unset                  | `off`           | **refused**: "must be required in production" (unchanged) |
| production     | set                    | `off` (default) | ok: the socket replaces TLS                               |
| any            | set                    | `required`      | **refused**: "TLS does not apply to a Unix socket"        |
| non-production | unset                  | `off`           | ok (local and CI, unchanged)                              |

Tests: config unit tests for every row; `pool.test.ts` for `socketPath` in the options;
an integration test that connects through a real Unix socket (the compose MySQL's socket
exposed as a volume, or a `socat` relay in CI to the service container), and the TCP+TLS
path stays covered as today. Each guard is proven by removal (CLAUDE.md).

## 4. The API on Cloud Run

| Setting        | Value                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Image          | `us-east1-docker.pkg.dev/<project>/gradfolio/api:<git sha>`; deploys always by sha, never `latest`                                          |
| Container port | 3000 (`--port=3000`; no `PORT` mapping)                                                                                                     |
| CPU / memory   | 1 vCPU, 512 MiB, request-based billing (CPU only while serving)                                                                             |
| Concurrency    | 40 (Node, I/O-bound, tiny load)                                                                                                             |
| Max instances  | 3; `DATABASE_POOL_MAX=5` per instance, so at most 15 connections on a micro instance                                                        |
| Timeout        | 30 s                                                                                                                                        |
| Ingress / auth | all, `--allow-unauthenticated`: Vercel has no Google identity. Every route but `@Public()` demands a valid Auth0 token (`AccessTokenGuard`) |
| Probes         | startup: `GET /readyz`, period 5 s, up to 6 failures. Liveness: see below                                                                   |
| Min instances  | **Levon chooses**, §7                                                                                                                       |

**Liveness deviation (for Levon).** The brief says `/readyz` for both. `/readyz` checks the
database, so a short database outage would make Cloud Run kill and restart every healthy
instance for nothing. Recommended: startup probe on `/readyz` (do not take traffic until
the database answers), liveness on `/healthz` (restart only a wedged process).

### Environment and secrets

No value below is a secret except where marked. Non-secrets are plain env vars on the
service; secrets are `--set-secrets` from Secret Manager.

| Variable                  | Where                               | Value / source                                                                                                 |
| ------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | env                                 | `production`                                                                                                   |
| `LOG_FORMAT`              | env                                 | `json` (Cloud Logging parses it); `LOG_LEVEL=info`                                                             |
| `API_DOCS_ENABLED`        | env                                 | `false`                                                                                                        |
| `TRUST_PROXY`             | env                                 | `1`, proved in Phase 3 (§1.4)                                                                                  |
| `DATABASE_SOCKET_PATH`    | env                                 | `/cloudsql/project-33e407b5-7fd5-485d-8dc:us-east1:gradfolio-db`                                               |
| `DATABASE_SSL`            | env                                 | unset (`off`): the socket rule of §3.3                                                                         |
| `DATABASE_POOL_MAX`       | env                                 | `5`                                                                                                            |
| `DATABASE_URL`            | **secret** `gradfolio-database-url` | `mysql://gradfolio_app:<password>@localhost/gradfolio`; password is generated hex, so it needs no URL encoding |
| `AUTH0_ISSUER_BASE_URL`   | env (not secret)                    | the current `dev-….auth0.com` tenant, with trailing slash (**Levon: confirm, §9**)                             |
| `AUTH0_AUDIENCE`          | env (not secret)                    | `https://api.gradfolio.app`                                                                                    |
| rate limits, profile caps | env                                 | schema defaults                                                                                                |

The migrate job gets `NODE_ENV=production`, `DATABASE_SOCKET_PATH`, `DATABASE_POOL_MAX` is
forced to 1 by the CLI, and **secret** `DATABASE_URL` from `gradfolio-migrate-database-url`.
It has no Auth0 variables.

Passwords are generated on the machine (`openssl rand -hex 24`) and piped straight into
`gcloud secrets` and `gcloud sql users`; they are never printed, never written to a file.
Levon never has to type one. (If Levon prefers to enter them in the console, say so.)

## 5. Migrations: a Cloud Run job, in the pipeline only

`gradfolio-migrate` (same image, migrator secret, same VPC settings) runs `up`. CI
updates the job to the new image and executes it with `--wait` **before** the new
revision is routed any traffic. A non-zero exit stops the pipeline: nothing deploys.
Nobody runs it by hand outside the pipeline, except the one-time first run, which is
the pipeline's own first run.

- **Expand/contract rule.** For a moment the old revision runs against the new schema,
  so a migration must work with the previous release's code (add before use; remove only
  one release after the code stops using it). Written into `docs/deploy.md`.
- Idempotence: the second run prints nothing to apply (the runner records each step; its
  lock is `MIGRATION_LOCK_TIMEOUT_S`, so overlapping runs wait, never both apply).
- The first run creates the schema in the empty database (`0001_baseline` onward).
  There is nothing to diff against Aiven: it is gone. Nothing is seeded unless Levon approves.

## 6. CI/CD: GitHub Actions, Workload Identity Federation

**Trigger: push to `main` after the `CI` workflow succeeds** (`workflow_run`, so a red
main never deploys), a docs-only push also redeploys (same behaviour, deferred follow-up), and a re-run of an older CI run is refused unless its sha is the tip of main. Recommended over tags: this is a
coursework project with one environment; every merge is deployable, and a tag-per-deploy
is ceremony. v1.0.0 is tagged in M9 separately. A `concurrency` group serializes deploys.

Steps (`.github/workflows/deploy.yml`, `permissions: id-token: write, contents: read`):

1. Check out the commit that passed CI (`workflow_run.head_sha`).
2. `google-github-actions/auth` with the WIF provider and `gradfolio-deployer`.
3. `docker build` and push `api:<sha>` to Artifact Registry.
4. `gcloud run jobs deploy gradfolio-migrate --image api:<sha> --execute-now --wait`
   (fails the pipeline on error; log shows the applied migrations).
5. `gcloud run deploy gradfolio-api --image api:<sha> --no-traffic --tag candidate`.
6. Smoke: `curl` the tagged revision URL: `/healthz` 200 and `/readyz` 200 with the
   database ok. Otherwise stop; the live revision is untouched.
7. `gcloud run services update-traffic gradfolio-api --to-latest`.

Workload Identity Federation: pool `github`, OIDC provider
`https://token.actions.githubusercontent.com`, attribute condition
`assertion.repository == 'Levon0Asatryan/gradfolio-api' && assertion.ref == 'refs/heads/main'`
(no pull request, fork or other branch can authenticate). Only the principal for that
repo may impersonate `gradfolio-deployer`. **No service-account key is ever created.**
`gradfolio-deployer` holds: `roles/run.developer`, `roles/artifactregistry.writer` on the
one repo, and `roles/iam.serviceAccountUser` on the two runtime accounts, nothing else.
Its identifiers (pool path, service account) are not secret and sit in the workflow as
repository variables.

**Rollback, one command** (traffic back to the previous revision, no rebuild):

```sh
gcloud run services update-traffic gradfolio-api --region us-east1 --to-revisions <previous-revision>=100
```

Find the revision with `gcloud run revisions list --service gradfolio-api --region us-east1`.
A rollback does not undo a migration: this is what the expand/contract rule is for.

## 7. Min instances: Levon chooses

Both cost the same service; one vCPU, 512 MiB, plus the database.

| Choice                  | Monthly                                                                                               | Behaviour                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **0** (scale to zero)   | about $0 for Cloud Run (inside the free tier at this load)                                            | first request after idle waits for a cold start (Node boot + database connect, a few seconds) |
| **1** (always one warm) | idle: 2,628,000 s × ($0.0000025 × 1 vCPU + $0.0000025 × 0.5 GiB) = about **$9.86**, plus request time | no cold starts                                                                                |

Recommendation: **0**, and switch to 1 for demo and defense days with one command
(`gcloud run services update gradfolio-api --min-instances 1`). Documented in `docs/deploy.md`.

## 8. Monthly total against the credits

| Line                                                       | Min 0          | Min 1           |
| ---------------------------------------------------------- | -------------- | --------------- |
| Cloud SQL `db-f1-micro`                                    | $7.67          | $7.67           |
| Cloud SQL storage 10 GiB                                   | $1.70          | $1.70           |
| Cloud SQL backups (daily, tiny)                            | about $0.10    | about $0.10     |
| Cloud Run service                                          | about $0       | about $9.86     |
| Cloud Run jobs, Artifact Registry, Secret Manager, Logging | about $0       | about $0        |
| Public IPv4 (only on the fallback)                         | $0 (private)   | $0 (private)    |
| **Total**                                                  | **about $9.5** | **about $19.3** |

Against the **$300** trial credit that is about 31 months (min 0) or 15 months (min 1)
of runway in money terms. But the trial credit **expires after 90 days** (Google's terms):
after that the card is billed at the totals above unless the student credit applies.
The budget alert (Levon's) must exist; `docs/deploy.md` records its thresholds, and the
plan checks it (`gcloud billing budgets list`) before the first billed resource.
Deletion protection and a 20 GiB storage cap bound a runaway.

## 9. What Levon must click or approve

1. **Approve this plan and its cost** (min 0: about $9.5 / mo, min 1: about $19.3 / mo).
   Nothing billed is created before that. This is the "explicit OK" for creating the
   Cloud SQL instance, which starts billing at once.
2. **Choose min instances** (0 recommended).
3. **Choose the liveness probe** (`/healthz`, recommended, or `/readyz` as briefed).
4. **Auth0 values.** Confirm that production uses the existing `dev-….auth0.com` tenant
   until 9.4, give its domain (not secret) for `AUTH0_ISSUER_BASE_URL`, and confirm the
   audience `https://api.gradfolio.app`. If the tenant differs, tell us before deploy.
5. **Tell us when the budget alert exists** (name or thresholds), or confirm it has.
6. **GitHub repository variables** are set by us through `gh` if Levon allows, otherwise
   Levon pastes three non-secret values (the WIF provider path, the deployer service
   account, the project id).
7. **Vercel** (after the API is live): `API_BASE_URL=<Cloud Run URL>` for **Production**
   and **Preview**, then a production redeploy. The frontend reads exactly
   `API_BASE_URL` (`src/lib/api/client.ts`, `.env.example`), server-side only, so no CORS.
   The orchestrator or Levon applies it through the Vercel MCP; we supply the value, which
   is not a secret. **Decision for Levon:** Preview pointing at the production API also
   points previews at the production database; 9.3 said previews should use a non-production
   API. Previews cannot log in today (Auth0 callbacks), so the exposure is anonymous reads.
   Recommended: set Preview now so M3 previews render; revisit in 9.3.
8. **Later, not now:** custom domain (not free and trivial: skipped), the production
   Auth0 tenant, a real token for Phase 3 (Levon signs in on the live frontend).

## 10. Order of work after approval

1. Code PR: `DATABASE_SOCKET_PATH` and the TLS rule (tests, guard-removal proofs, both
   reviewers). Merges independently of the infrastructure. **It also changes
   `.github/workflows/ci.yml`**: the integration job gains a `socat` step that relays a
   Unix socket to the MySQL service container, plus the env var the socket test reads.
   `deploy.yml` is a separate, new workflow; `ci.yml` stays the gate it waits on.
2. Infrastructure by `gcloud` (each command listed in `docs/deploy.md`): APIs, network
   peering, Cloud SQL, database, users, secrets, registry, service accounts, WIF.
3. `deploy.yml` PR; first run builds, migrates, deploys.
4. Vercel variable, redeploy. Message the M3 lead when Phase 3 items 1 to 4 pass.
5. `docs/deploy.md` (runbook: resources, costs, environment table without values,
   migrate, rollback, password rotation, budget alert) and `docs/deploy-verification.md`.

## 11. Proposed tracker changes (not applied: this chat does not edit `docs/tracker.md`)

- Q9: answered, Cloud Run + Cloud SQL MySQL 8.4, `us-east1`.
- 9.1: replace "Aiven ... pinned CA" with the Cloud SQL design; the Aiven baseline diff
  becomes the dump-and-diff against the empty instance.
- 9.2: points here. M2 follow-up "(ops, 9.2) set `TRUST_PROXY`" closes with Phase 3's proof.
- New follow-ups: min-instance choice; Preview API pointing at production (9.3);
  PITR off by decision; trial credit expiry date.
