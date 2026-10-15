You are a worker chat on gradfolio-api, the NestJS 12 + MySQL 8.4 backend for
Gradfolio, a student portfolio platform (NPUA coursework). GitHub:
Levon0Asatryan/gradfolio-api.

Start in `/Users/levon/Dev/university/gradfolio-repos/gradfolio-api` so CLAUDE.md
loads. Work in your own worktree:

```sh
git fetch origin
git worktree add ../gradfolio-api-deploy -b deploy/plan origin/main
```

**An M3 chat is working in parallel** (worktrees `gradfolio-api-m3` and
`gradfolio-m3`, Docker project `gradfolio-m3` on ports 3309/3003). Don't touch its
worktrees, branches or containers. If you need local Docker, use project
`gradfolio-deploy` and ports 3311/3005.

Read first:

1. CLAUDE.md
2. AGENTS.md
3. docs/tracker.md (M9 tasks 9.1–9.3, Q9, Follow-ups)
4. docs/auth0-setup.md
5. docs/m2-plan.md (the `TRUST_PROXY` hop count, token config)
6. docs/m1-plan.md (the migrator)
7. Dockerfile
8. docker-compose.yml
9. .env.example

## Task

**Minimal production deployment of the API on Google Cloud, now, ahead of M9.**

- The frontend on Vercel deploys from `main`, and it already calls the API.
  gradfolio#23 is live, so production profile pages render "not found" until a live
  API URL is set.
- M3's remaining frontend PRs wait for this.
- The rest of M9 (a separate production Auth0 tenant, the security pass, the full
  verification, demo data) stays at the end.

**Levon decided (2026-10-05):**

- **Docker on Cloud Run.** Not a plain VM, not Kubernetes.
- **Facts already established:**
  - GCP project id `project-33e407b5-7fd5-485d-8dc` (name `gradfolio`), billing
    enabled;
  - `gcloud` logged in as levonasatryan1098@gmail.com;
  - Cloud SQL's default MySQL version is **8.4.11**, the same version our CI tests
    on.
  - The Aiven database is gone. There is no data to migrate; production starts
    empty.

- **Google Cloud:** Cloud Run for the API, Cloud SQL for MySQL.
- **Not Aiven.** The old Aiven database is abandoned: nothing is migrated from it
  unless Levon asks. Production starts empty, and you seed it only with what Levon
  approves.
- **Levon does:** the account, the $300 trial and student credit, a project
  `gradfolio` with billing linked, a budget alert, the region, and `gcloud` logged
  in. Ask him for the project id and the region. **Any action that creates a billed
  resource needs his explicit OK**, so show him the expected monthly cost first.

## Scope

In:

1. **Cloud SQL, MySQL 8.4.**
   - **First verify that Cloud SQL offers MySQL 8.4 in the chosen region** (our code
     and the two MySQL bugs we designed around were checked on 8.4.11). If it
     doesn't, stop and report.
   - The smallest shared-core tier (cite the current price), automated backups on,
     private connectivity where practical.
   - A `gradfolio` database, and an app user with only the rights it needs.
   - Check the instance's default collation, and its `sql_mode` and `time_zone`
     against what M1 relies on.
2. **The connection.** Cloud Run reaches Cloud SQL through its built-in Cloud SQL
   connection (a Unix socket at `/cloudsql/<instance>`), so there is no public
   database port.
   - Today `src/core/db/pool.ts` takes only `DATABASE_URL` (host and port). Add a
     validated socket option (for example `DATABASE_SOCKET_PATH`, or the socket in
     the URL), with unit and integration tests, as a small code PR.
   - TLS rules: a socket connection doesn't need `DATABASE_SSL=required`, but the
     production config refine currently demands it. Adjust that rule deliberately,
     and test both paths.
3. **The API on Cloud Run.**
   - The image is built from our Dockerfile and pushed to Artifact Registry.
   - `/readyz` as the startup and liveness check.
   - Configuration from the validated schema: `NODE_ENV=production`, the database
     settings, `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`, the `TRUST_PROXY` hop count
     correct for Cloud Run's front end (verify it), log format json, API docs off.
   - Secrets in **Secret Manager**.
   - Min instances 0 or 1: show Levon both costs, and he chooses.
   - Concurrency and memory sized for our tiny load.
4. **Migrations** run as a **Cloud Run Job** using the same image, executed before
   each new revision takes traffic. Never by hand. A second run must show nothing to
   apply.
5. **CI/CD:** a GitHub Actions workflow on `main` (or on tags; you recommend). It:
   - builds, pushes, runs the migrate job, then deploys;
   - authenticates with **Workload Identity Federation**, so no service-account keys
     are stored.
     Rollback is shifting traffic to the previous revision, written down as one
     command.
6. **Vercel:** the API base URL variable the frontend's API client reads (check its
   exact name in `gradfolio/src` and `.env.example`) for **Production** and
   **Preview**, then redeploy production. The Vercel MCP is available in the
   workspace chat; ask Levon or the orchestrator to apply it.
7. `docs/deploy.md`, the runbook:
   - project and region;
   - the resources and their monthly cost;
   - the environment table, with no secret values;
   - migrate, rollback;
   - rotating the database password;
   - the budget alert.

Out:

- A new Auth0 tenant (9.4, M9).
- A custom domain, unless free and trivial.
- Scaling or multiple regions.
- Feature code beyond the socket option.

## gcloud: credentials stay in the university sandbox

gcloud is installed in `~/Dev/university/.sandbox`. Its config and credentials live
**only** in `.sandbox/gcloud` (`CLOUDSDK_CONFIG`, set by `~/Dev/university/.envrc`).

**Before your first gcloud command, and in every new shell**, run:

```sh
eval "$(direnv export bash 2>/dev/null)"
gcloud info --format='value(config.paths.global_config_dir)'
```

It must print `/Users/levon/Dev/university/.sandbox/gcloud`. If it prints anything
else, stop: a gcloud command would then write credentials to `~/.config/gcloud`,
outside the sandbox. `sandbox-check` must stay all green, and `~/.config/gcloud` must
never exist.

Docker's login to Artifact Registry goes through `DOCKER_CONFIG`, which is also
sandboxed. Never create a service-account key file: CI uses Workload Identity
Federation, and locally you use Levon's gcloud login.

## Secrets

Never put a secret in the repo, a PR, a log or this chat:

- the database password and any tokens go into Secret Manager (and Vercel for the
  frontend) only;
- Levon enters them himself where a dashboard is needed;
- Vercel and Auth0 MCPs may be available in the workspace chat
  (`gradfolio-repos`), not in yours. Ask Levon or the orchestrator to apply
  Vercel/Auth0 changes, and give the exact key, target and value source. Never
  paste a secret value.

## Phase 1: Investigation, then the plan

`docs/deploy-plan.md`, as a docs PR covering:

- Cloud SQL MySQL 8.4 availability, and current prices for Cloud SQL, Cloud Run and
  Artifact Registry, with links to the live pages;
- the socket-connection design and the change to the TLS config rule;
- the design for the migrate job and CI/CD (Workload Identity Federation);
- the environment and secrets table;
- the min-instances cost choice;
- the monthly total against Levon's credits;
- exactly what Levon must click or approve.

**Stop and report.**

## Phase 3: Final test

Record it in `docs/deploy-verification.md`:

1. `https://<api>/healthz` answers 200; `/readyz` answers 200 with database ok.
2. Migrations applied on Cloud SQL by the job. A second run shows nothing to apply.
   The schema matches the expected dump (the M1 dump-and-diff method, through all
   current migrations).
3. A **real Auth0 token**, obtained by Levon through the production frontend login:
   - `GET /v1/me` on the live API creates or returns his user;
   - a request with no token answers 401;
   - a wrong-audience token answers 401.
4. The live frontend `https://gradfolio-navy.vercel.app`: log in, and `/account`
   shows the user from the live API.
5. Rollback rehearsed once (traffic to the previous revision, then back).
6. No secret appears in the repo, the PR or the logs (grep the build and runtime
   logs for the password and the token prefix).
7. Local containers and worktree cleaned up.

## Reviews and stop points

- Both reviewers on every push (`sh scripts/request-review.sh <pr>`); Copilot quota
  failures are accepted.
- Two rounds, then fix-now findings only, plus one confirmation round on the head.
- **Stop:** after the plan PR, and whenever Levon must act (the GCP project, billing approvals, Vercel values, test tokens).
- Do not merge, do not push to main, do not edit docs/tracker.md (propose changes
  instead).

## Reporting

Send reports to the orchestrator **gradfolio-repos-a2** with SendMessage, in the
format from docs/handoff-template.md, part 2. If it isn't in ListAgents, write to
`/Users/levon/Dev/university/gradfolio-repos/deploy-report.md`.

**When the API is live and Phase 3 items 1–4 pass, also message the M3 lead chat**
(started in `gradfolio-repos`; find it in ListAgents). Tell it: "API live at
`<url>`; Production and Preview API URL set". Its frontend step-2 PRs wait for that.
