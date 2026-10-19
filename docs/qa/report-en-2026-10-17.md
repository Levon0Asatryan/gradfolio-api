# Gradfolio Final QA Report

**Report date: 2026-10-17.** Frontend: `9d6b214` plus local fixes. API: `f131ba6`. Previous full run: 2026-10-16. Additional verification: 2026-10-17. Status statements below describe the state recorded during those runs.

## Results summary

The 55 previously skipped signed-in browser cases have now been executed against a real local frontend, API and MySQL stack. The complete 64-case run passed with no skips or retries. It includes those 55 cases, 7 anonymous cases and 2 new regression checks. The matrix covered English, Russian and Armenian, light and dark themes, 390 and 1440 px viewports, accessibility and keyboard controls.

Authentication used the project's existing test issuer and Auth0 SDK test session cookies. The API verified signed tokens, and data was stored in an isolated MySQL 8.4 database. This verifies functionality after authentication; it does not verify the configuration of hosted Auth0 or social login services.

There are **4 confirmed issues**: one public navigation defect and three lint/browser testing defects. Local fixes are prepared for all four. At the time of this report, these changes had not been committed, pushed or deployed.

## Test scope and results

| Check                                | Result                                                                               | Environment and date                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Frontend unit tests                  | 1,412/1,412 in the baseline run. The subsequent full coverage suite also passed.     | Linux, 2026-10-16                                         |
| Frontend coverage                    | 89.98% statements, 91.13% lines                                                      | After local fixes, 2026-10-16                             |
| API unit tests                       | 1,024/1,024, 95.2% statement coverage                                                | Linux, 2026-10-16                                         |
| API integration tests                | 870/870 across 51 files                                                              | Real MySQL 8.4, 2026-10-16                                |
| Public browser suite                 | 313 passed; 55 signed-in cases were initially skipped                                | Production build and stub API, 2026-10-16                 |
| Signed-in and related browser checks | 64/64 passed, 0 skipped, 0 retries                                                   | Real local API and database, 2026-10-17                   |
| Additional regression checks         | 3/3 passed; 2 are already included in the 64-case run                                | HTTP/network errors and JavaScript exceptions, 2026-10-17 |
| Additional user journeys             | All 24 cases have a final passing result across the main and targeted follow-up runs | Real frontend, API and database, 2026-10-17               |
| Operational checks                   | 8/8 passed                                                                           | Real local API, 2026-10-17                                |
| Frontend and API production builds   | Both passed                                                                          | Linux Node 24, 2026-10-17                                 |
| Migration rollback                   | Applied 0001-0009, rolled back 0009, reapplied it; the next up made no changes       | Separate empty QA database, 2026-10-17                    |
| Database outage and recovery         | Database stopped: health 200, readiness 503. After restart: both 200.                | Isolated QA environment, 2026-10-17                       |
| Runtime dependency audit             | Frontend: 0 advisories. API: 0 advisories.                                           | npm audit --omit=dev, 2026-10-17                          |

These figures describe different testing layers and must not be added together as a count of unique user scenarios. The [75-case acceptance catalog](test-cases.md) also includes external services and features that are not yet implemented.

The 24 additional journeys checked two users' pages, profile persistence, project creation and editing, invalid URL rejection without form data loss, the public back link, rejection of another user's writes and deletes, project privacy, team invitation/decline/re-invitation/acceptance/leave flows, external teammates, HTML sanitization, Unicode tags, duplicate technologies, draft publishing, project and account deletion, stable account provisioning under concurrent first requests, invalid tokens, education entry creation/editing/reordering/deletion, duplicate skills and attachment link management.

Some initial expectations in the additional QA scripts were corrected to match the actual UI and API contract, then the affected cases were rerun. These were not counted as application defects. In particular, under the M4 policy, making a profile private does not automatically make its separately public project private. The project's own visibility setting controls that access.

## Confirmed issues and solutions

### 1 Public project back link requires login

**Problem:** For an anonymous visitor, Back to Projects pointed to the protected `/projects` page and then redirected to Auth0 login. This interrupted the public project browsing journey.

**Solution:** Owners retain the `/projects` destination; other visitors are sent to `/browse/projects`. Two regression tests were added, and the local fix was verified. Production verification requires a new deployment. [GitHub issue 113](https://github.com/Levon0Asatryan/gradfolio/issues/113).

### 2 Lint crashes after Playwright generates its report

**Problem:** ESLint scanned generated Playwright trace assets and failed with `RangeError: Invalid string length`.

**Solution:** Excluded `playwright-report` and `test-results` from ESLint. Lint, coverage and build reruns passed with generated browser output present. [GitHub issue 114](https://github.com/Levon0Asatryan/gradfolio/issues/114).

### 3 Signed-in tests treat local Vercel script failures as application errors

**Problem:** Dashboard, notifications, team and teams checks failed because two analytics scripts returned 404 locally. A separate browser probe identified `/_vercel/insights/script.js` and `/_vercel/speed-insights/script.js` as the failing resources.

**Solution:** Added a shared console/network watcher that accounts for hosting-only Vercel scripts and cancelled Next RSC prefetches while continuing to record genuine HTTP, network and uncaught JavaScript errors. Regression checks include a deliberate HTTP 500 and JavaScript exception. The 64-case run passed after the correction. [GitHub issue 115](https://github.com/Levon0Asatryan/gradfolio/issues/115).

### 4 Notification badge test inspects a hidden background button

**Problem:** After marking a notification read, the test checked the background bell's accessible name while its dialog remained open. MUI correctly removes the background from the accessibility tree at that point, so the test received an empty accessible name. The API count had already decreased correctly.

**Solution:** After confirming the API count change, the test closes the dialog and checks the bell's accessible name. The case passed on rerun. This was a test defect, not a confirmed product notification counter defect. [GitHub issue 116](https://github.com/Levon0Asatryan/gradfolio/issues/116).

## Operational verification details

| Case                                       | Verified outcome                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing Auth0 issuer/audience              | Startup fails and identifies the missing settings.                                                                                                              |
| Invalid API port                           | Startup is rejected.                                                                                                                                            |
| Production database connection without TLS | Configuration is rejected.                                                                                                                                      |
| Unknown route or unsupported method        | 404 with stable NOT_FOUND JSON and no stack trace.                                                                                                              |
| Malformed or oversized JSON                | 400 BAD_REQUEST and 413 PAYLOAD_TOO_LARGE, respectively.                                                                                                        |
| Default per-user rate limit                | First 120 requests succeed; request 121 returns 429 with Retry-After. Another user continues to receive 200.                                                    |
| Signed-in search rate limit                | First 30 requests succeed; request 31 returns 429.                                                                                                              |
| Small load exercise                        | 100 reads at concurrency 10, all returning 200. Median: 66 ms; p95: 106 ms; maximum: 113 ms. These are local measurements, not a production capacity guarantee. |

## Dependencies and environment

The complete dependency tree audit reported 5 high-severity entries in the frontend and 3 in the API. They relate to the `braces` stack exhaustion advisory and development tooling that depends on it: `micromatch`, `fast-glob`, `knip`, `kysely-codegen` and the Next ESLint plugin. These are not eight independent application vulnerabilities. Runtime-only audits reported zero advisories in both projects during this run.

The follow-up is to update compatible development tool versions and rerun verification. Major changes or downgrades proposed by `npm audit fix --force` were not applied without compatibility checks. Sources: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and the saved npm audit reports.

Linux is the basis for the complete automated results because the initial native Windows runs encountered POSIX fixture and locale limitations. A single Armenian accessibility timeout passed on retry in the earlier browser run. The new 64-case signed-in run passed without retries.

## Items not yet verified

| Area                                                              | Reason                                                                            | Required follow-up                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Real Auth0, Google, GitHub and LinkedIn login; email verification | Suitable test accounts and external service access were not provided.             | Exercise real login and logout through the configured connections.          |
| Real GitHub connect/import/re-sync/revoke                         | Automated fixtures were tested; the external account journey was not executed.    | Use a test GitHub connection and two importable repositories.               |
| Real GCS signed uploads and object cleanup                        | No bucket credentials were available locally. Integration tests use fake storage. | Run upload/read/delete/sweep against an isolated test GCS bucket.           |
| LinkedIn export import                                            | M7 implementation is incomplete, and no real export was available.                | Complete the parser/wizard, then test real exports and malformed ZIP files. |
| Resume PDF and invitation email                                   | M8 work is incomplete. AI generation is stretch scope.                            | Complete the planned features and run their acceptance cases.               |
| Production rollback, load and private configuration               | Local checks do not establish these production properties.                        | Repeat operational checks in staging, then verify production settings.      |

Deployed anonymous journeys and API readiness were checked on 2026-10-16. The additional local results are not a new verification of the deployed site or evidence of a new deployment.

## Next actions

1. Review and commit the local fixes, and include them in CI.
2. Deploy the frontend fix and repeat issue 113's public navigation journey in production.
3. Complete required M7/M8 work and the external Auth0/GitHub/GCS checks.
4. Perform final release acceptance once these prerequisites are closed. This is the final record of the tests performed, not unconditional approval of the complete v1 release.

Detailed references: [75 acceptance cases](test-cases.md), [2026-10-16 run log](run-2026-10-16.md), [repeatable QA scripts](scripts/), [2026-10-17 evidence summary](evidence-2026-10-17/final-summary.json).
