## Task

Minimal production deployment of the API on Google Cloud (Cloud Run + Cloud SQL MySQL 8.4), ahead of M9.

## Status

done (one docs PR open: #36). API live at https://gradfolio-api-1058577031182.us-east1.run.app

## Pull requests

- gradfolio-api #32 plan — merged
- #33 DATABASE_SOCKET_PATH + TLS rule — merged (CI green; Codex no findings; Copilot quota)
- #34 deploy.yml (WIF, migrate job, no-traffic smoke) — merged (2 Codex P1 + 1 P2: one fixed, two deferred with replies)
- #35 docs/deploy.md, docs/deploy-verification.md — merged (1 P1 fixed)
- #36 first pipeline run, logins, budget recorded — open, docs only
- gradfolio-sql #2 Aiven -> Cloud SQL wording — merged

## Investigation

- MYSQL_8_4 and db-f1-micro offered in us-east1; created instance is 8.4.11-google.
- Prices read from the Cloud Billing Catalog API (pricing pages did not render).
- mysql2 3.24.4: `{uri, socketPath}` keeps credentials from the URL, socket replaces host/port (run).
- `/healthz` is reserved by Cloud Run on *.run.app (Google 404). Changed smoke test and verification to /readyz.
- API-created Cloud SQL users get role cloudsqlsuperuser: revoked, grants applied.

## What changed

Config: optional DATABASE_SOCKET_PATH (validated); production without a socket still needs DATABASE_SSL=required; socket + required refused. GCP: private-IP Cloud SQL, Cloud Run service + migrate job, Secret Manager, Artifact Registry, WIF. CI/CD: deploy.yml after CI on main. Vercel: API_BASE_URL (Production, Preview), production redeployed.

## Revalidation

Plan vs result: all in-scope items done. Min instances 1 (Levon), liveness on /healthz (Levon).

## Re-review

Codex reviewed every head; Copilot quota failures on every push. Threads resolved.

## Decisions made

Private IP only; two DB users; workflow_run trigger; stale-sha refusal; PITR off; budget raised by Levon to 25 USD.

## Evidence

See docs/deploy-verification.md: migrations applied by job and second run no-op; schema identical to local; /readyz 200; /v1/me 401 without token and 200 with Levon's real login (Google and GitHub both tested by Levon); TRUST_PROXY=1 proven (140 forged-XFF requests: 120x404, 20x429); rollback rehearsed; first pipeline run succeeded on b80ff32; no secret in logs/repo (0 hits).

## Not verified

Wrong-audience token live (covered by integration suite). Pipeline behaviour on a failed migration (not forced).

## Defects found

/healthz unreachable on run.app (fixed in workflow/docs). Default cloudsqlsuperuser on DB users (revoked).

## Changes needed in other repos

gradfolio: none. gradfolio-sql: done (#2).

## Open questions for Levon

None. Proposed tracker changes (not applied): Q9 answered Cloud Run + Cloud SQL us-east1; 9.1/9.2 done by this work (9.3 API half done); close M2 follow-up "(ops, 9.2) TRUST_PROXY" (=1, proved); new follow-ups: docs-only pushes redeploy; Preview API points at production DB (9.3); trial credit expires after 90 days; min-instances 1 costs ~$19.3/mo; Vercel stale vars already tracked.
