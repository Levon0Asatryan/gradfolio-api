# QA records and local verification

The dated reports record the state of the October 16–17, 2026 runs. They are historical evidence, not a live deployment status page. The acceptance catalog is [test-cases.md](test-cases.md); the current report for sharing is [qa-report-hy-2026-10-17.md](qa-report-hy-2026-10-17.md), with an [English version](final-report-en-2026-10-17.md).

The four frontend fixes belong to [gradfolio](https://github.com/Levon0Asatryan/gradfolio/issues?q=is%3Aissue+113+114+115+116). This repository contains their QA evidence and the local test harness. No API endpoint or database schema changes are required.

## Reproduce the local authenticated run

Use Linux Node 24 and an isolated MySQL 8.4 container. The commands below run inside a disposable Node container on the same Docker network as MySQL. Clone the two repositories into `/qa/gradfolio-api` and `/qa/gradfolio`; do not reuse a production database.

The MySQL container must have the network hostname `gradfolio-qa-mysql-20261017`, database `gradfolio`, and a local test user with migration privileges. The harness checks the exact database host, port and name before running migrations or seeding demo users. Its known cookie secret and signing keys are disposable test fixtures, not service credentials.

```sh
cd /qa/gradfolio-api
HUSKY=0 npm ci
npm run build
node --test docs/qa/scripts/qa-database.test.mjs

cd /qa/gradfolio
HUSKY=0 npm ci
npm run build
npx playwright install --with-deps chromium

mkdir -p /qa/state /qa/results
export DATABASE_URL=mysql://gradfolio:gradfolio@gradfolio-qa-mysql-20261017:3306/gradfolio
cd /qa/gradfolio-api
node --import tsx docs/qa/scripts/local-stack.mts
```

Keep that process running. It starts the real API on port 3001, the frontend production build on port 3100, and the existing local JWKS test issuer. It creates synthetic accounts A–D and session files in `/qa/state`, outside both repositories. No hosted Auth0 login is performed. Wait for `http://localhost:3100/settings` to respond before running browser tests from another shell in the same container.

```sh
cd /qa/gradfolio-api
node docs/qa/scripts/prepare-matrix.mjs

cd /qa/gradfolio
PLAYWRIGHT_BASE_URL=http://localhost:3100 \
E2E_STORAGE_STATE_A=/qa/state/a.json \
E2E_STORAGE_STATE_B=/qa/state/b.json \
E2E_PROJECT_ID=b2000000-0000-4000-8000-000000000001 \
npx playwright test dashboard.spec.ts notifications.spec.ts team.spec.ts teams.spec.ts console-problems.spec.ts --workers=2 --retries=0

cd /qa/gradfolio-api
node docs/qa/scripts/browser-journeys.mjs
node docs/qa/scripts/operational-checks.mjs
```

`operational-checks.mjs` also needs the same `DATABASE_URL` in its shell. It starts a second API on port 3002 with default per-user rate limits; the functional browser server uses higher limits so the matrices do not consume the rate-limit test's allowance. The SDK's test cookie helper expires cookies after one hour; use `refresh-sessions.mjs` before another long run. Restarting `local-stack.mts` reseeds the disposable database.

For a targeted browser rerun, set `QA_CASES` to comma-separated case IDs and supply `QA_PROJECT_ID` and `QA_PROJECT_TITLE` for cases that depend on a previously created project. Use a new `QA_RESULT_DIR` to retain the earlier results. `collect-evidence.mjs` consolidates the specific main/recheck filenames from the recorded October 17 run; retain those inputs when reproducing that consolidation.

`health-probe.mjs` checks liveness/readiness while the QA database is stopped (`QA_EXPECT_READY_STATUS=503`) and after it is restarted (`QA_EXPECT_READY_STATUS=200`). Stop only the isolated test database. The migration rollback record used a separate empty database, `qa_rollback`.

The PDF builder uses Python ReportLab and Windows Arial fonts; it accepts `hy` or `en`. Its output is a report artifact, not an application feature. Remove the disposable containers, volumes and session files after saving non-sensitive results. Do not commit session cookies, tokens, external credentials or real LinkedIn export contents.
