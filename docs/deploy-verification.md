# Deployment verification (2026-10-05)

API `https://gradfolio-api-1058577031182.us-east1.run.app`, revision `gradfolio-api-00001-phc`, built from the PR #33 branch
(`f2e8f03`) by hand once, because the pipeline needs #33 and #34 merged first. The first pipeline run is recorded below.

| #   | Check                                     | Result                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/healthz` 200                            | **Not possible from outside.** Cloud Run reserves `/healthz` on `*.run.app` and answers a Google 404. The container's own liveness probe on `/healthz` passes (the revision is serving). `/readyz` → 200 `{"status":"ok","database":"ok"}`                     |
| 2   | Migrations by the job; second run; schema | Job applied 0001 to 0005 on an empty Cloud SQL database. Second run: `migrations: nothing to apply`. `dump-cli` through the job vs a fresh local MySQL 8.4 migrated the same way: identical (14 `CREATE TABLE`, blank lines ignored: Cloud Logging drops them) |
| 3a  | `GET /v1/me` with Levon's real token      | Levon logged in on the production frontend; the live API logged `GET /v1/me` 200 (and a POST 200) for the session                                                                                                                                              |
| 3b  | No token                                  | `GET /v1/me` → 401 `UNAUTHENTICATED`                                                                                                                                                                                                                           |
| 3c  | Wrong-audience token                      | **Not run live** (needs a token for another audience). Covered by the integration suite (`access-token` audience cases)                                                                                                                                        |
| 4   | Live frontend `/account`                  | Levon: logged in, `/account` shows everything. The frontend server called the live API (profile page request logged 404 for an unknown id)                                                                                                                     |
| 5   | Rollback rehearsal                        | New revision `gradfolio-api-rehearsal` took traffic; `update-traffic --to-revisions gradfolio-api-00001-phc=100` moved it back (`/readyz` ok); `--to-latest` returned to the new one (`/readyz` ok)                                                            |
| 6   | No secret in repo, PR, logs               | The three secret values' passwords searched in Cloud Logging (1 day) and in the last 50 commits of every ref: 0 hits each. Token prefix `eyJ` in logs: 0 hits                                                                                                  |
| 7   | Local cleanup                             | Compose project `gradfolio-deploy` removed with its volume; local image removed; `~/.config/gcloud` absent; `sandbox-check` 52/52. Worktrees `gradfolio-api-deploy` and `-ci` remain until their PRs merge                                                     |

## Other facts proven

- Cloud SQL: MySQL 8.4.11-google; `collation_server` and the database `utf8mb4_unicode_ci`; `sql_mode`
  `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`
  (the MySQL default); `time_zone` SYSTEM = UTC.
- Grants: `gradfolio_app` has `SELECT, INSERT, UPDATE, DELETE` on `gradfolio.*` and nothing else; `gradfolio_migrator` has
  all on `gradfolio.*` only. The default `cloudsqlsuperuser` role Cloud SQL gives API-created users was revoked from both.
- `TRUST_PROXY=1`: 140 anonymous requests with different forged `X-Forwarded-For` → 120 × 404 then 20 × 429. The forgery is ignored.

## Defects found

- `/healthz` is unreachable on `*.run.app`: plan and smoke test changed to `/readyz`.
- API-created Cloud SQL users hold `cloudsqlsuperuser` by default: revoked, then grants applied.

## First pipeline run (2026-10-05)

CI run 37283875234 was cancelled by the next push, so it was re-run; `Deploy` run 37284209780 then ran on `b80ff32` (the tip of `main`)
and every step succeeded: stale-sha check, Workload Identity Federation login (no key), build and push `api:b80ff32`, migrate job,
no-traffic candidate, `/readyz` smoke, traffic shift. Result: revision `gradfolio-api-00005-saf` serves 100% on that image;
`/readyz` → 200 with the database ok; the migrate job's last execution succeeded.

## Logins on production (tested by Levon)

Both social logins (GitHub and Google) work on `https://gradfolio-navy.vercel.app` against the live API.

## Budget

`Cost-Alert` raised by Levon after the min-instances-1 choice (about $19.3 / month).
