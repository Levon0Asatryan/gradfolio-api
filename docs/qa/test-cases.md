# Gradfolio v1 test cases

This is the executable acceptance catalog for the v1 journey in [tracker.md](../tracker.md#release-definition-v10). Run against an isolated MySQL 8.4 database first, then repeat the user journeys on the deployed frontend and API. Use two disposable accounts (A and B), a GitHub account with two importable repositories, and a consenting member's LinkedIn export. Never put credentials or real export contents in a report.

Record each case as **pass**, **fail**, **blocked** (missing prerequisite), or **not run** in a dated run log. Automated suite success is evidence for its named assertions; it does not replace a real signed-in or deployed journey. For every failure record the commit, environment, exact input, actual result, expected result, and a tracker link. The 2026-10-16 run is [here](run-2026-10-16.md).

## Common variants

Apply these variants to every relevant case, without creating separate rows for identical steps:

| Dimension  | Values                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| Identity   | anonymous, owner A, other user B, accepted teammate B, pending/rejected teammate B                          |
| Visibility | public profile/project; private profile/project; draft; deleted/unknown ID                                  |
| Input      | empty, valid boundary, over limit, malformed, duplicate, hostile HTML/URL, Unicode (Armenian/Russian/Latin) |
| UI         | English/Russian/Armenian; light/dark; 390/1440 px; keyboard only; slow/failing API                          |
| Data       | no rows, one row, multiple pages, concurrent edits/requests                                                 |

For browser views, check one `h1`, useful loading/empty/error states, no serious/critical axe findings, no console or hydration error, no horizontal scroll at 390 px, and focus recovery after dialogs. Where a test mutates data, use disposable records and verify persistence after reload.

## Repeatable automated run

Use Linux with Node 24 (the CI environment) and an isolated MySQL 8.4. From each repository root:

```sh
# gradfolio-api
npm ci
npm run verify
npm run test:coverage
npm run test:int
npm run db:types:check
npm run build

# gradfolio
npm ci
npm run verify
npm run test:coverage
npm run knip
npm run build
npx playwright install chromium
npm run e2e
```

The API integration suite needs `TEST_DATABASE_URL` and `TEST_ADMIN_DATABASE_URL` pointing at the disposable MySQL instance. The frontend Playwright default uses a stub public API; signed-in tests additionally need `E2E_STORAGE_STATE_A`, `E2E_STORAGE_STATE_B`, `E2E_PROJECT_ID`, and a real `PLAYWRIGHT_BASE_URL`. Keep those files and credentials outside both repositories.

| Catalog area | Existing executable suites                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| OPS          | API `src/core/db/migrator/*.int.test.ts`, `src/api/rate-limit/e2e`, CI workflows, container/health probes                  |
| AUTH/PRO     | API `src/api/auth/e2e`, `src/api/me/e2e`, `src/api/profiles/e2e`; frontend profile/account component tests                 |
| PRJ          | API `src/api/projects/e2e`, `src/api/files/e2e`; frontend project component tests and `e2e/smoke.spec.ts`                  |
| TEAM         | API `src/api/team/e2e`, `src/api/notifications/e2e`; frontend `e2e/team.spec.ts`, `teams.spec.ts`, `notifications.spec.ts` |
| DISC         | API `src/api/discovery/e2e`, `src/api/dashboard/e2e`; frontend `e2e/discovery.spec.ts`, `dashboard.spec.ts`                |
| INT          | API `src/api/integrations/e2e`, `src/core/github`; frontend `e2e/integrations.spec.ts`, `github-import.spec.ts`            |
| REL          | Frontend `e2e/smoke.spec.ts`, `truncated-text.spec.ts`; deployed manual journeys in the dated run log                      |

## Build, configuration, and service health

| ID     | Test and steps                                                                                                                        | Expected result                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| OPS-01 | Clean install both repositories with Node 24 lockfiles; run format, lint, type, unused-code (FE), and generated OpenAPI checks (API). | All static gates pass; generated contract matches source.                                                 |
| OPS-02 | Run frontend and API unit suites with coverage.                                                                                       | Every test passes and each repository's configured coverage floor holds.                                  |
| OPS-03 | Run API integration suite on MySQL 8.4.                                                                                               | All integration tests pass against the real driver/schema.                                                |
| OPS-04 | Build production frontend, API, and API container from a clean checkout.                                                              | Builds succeed without local secrets in the frontend build.                                               |
| OPS-05 | Apply migrations on an empty MySQL database, then rerun.                                                                              | All migrations apply once; second run is a no-op; generated DB types match.                               |
| OPS-06 | Start API, request `/healthz` and `/readyz`, stop/restart MySQL, then request again.                                                  | Liveness stays 200; readiness becomes 503 while DB is unavailable and recovers to 200.                    |
| OPS-07 | Start API with required Auth0 or database configuration absent/invalid.                                                               | Startup refuses the configuration with a safe, actionable error; no partial service.                      |
| OPS-08 | Make an anonymous public request and a protected request without a token.                                                             | Public route answers normally; protected route is 401 with stable code and no private data.               |
| OPS-09 | Send malformed JSON, unknown route, unsupported method, and an over-limit body.                                                       | Stable 4xx response, safe message, no stack trace or internal address.                                    |
| OPS-10 | Repeat rate-budgeted requests from one caller and from a separate caller.                                                             | Limit applies per documented key/window; 429 includes a usable retry signal; second caller is unaffected. |
| OPS-11 | After a full Playwright run leaves `playwright-report` and `test-results`, run frontend lint again.                                   | ESLint ignores generated browser artifacts and still passes on project source.                            |

## Sign-up and identity

| ID      | Test and steps                                                                       | Expected result                                                                                                  |
| ------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| AUTH-01 | Sign up A with email/password and verify the email in Auth0.                         | Auth0 session succeeds; `email_verified` signal is reflected; one local user appears on first protected request. |
| AUTH-02 | Sign in through Google, GitHub, and LinkedIn connections with disposable identities. | Each enabled connection returns to the intended page; no access token reaches browser JavaScript.                |
| AUTH-03 | Log in A for the first time and issue concurrent `GET /v1/me` calls.                 | Exactly one user row and stable ID; profile gets allowed initial fields.                                         |
| AUTH-04 | Log out, revisit a protected route, then log in again.                               | Session is gone; redirect keeps the return path; same local account resumes.                                     |
| AUTH-05 | Send missing, malformed, expired, wrong-audience, and wrong-issuer bearer tokens.    | Each is rejected without exposing claims, secrets, or internal errors.                                           |
| AUTH-06 | Attempt to use A's session for B's account resources.                                | Owner-only reads/writes are denied with the specified 404/401, without confirming B's private data.              |
| AUTH-07 | Delete A's disposable account after confirmation; revisit protected routes.          | Account/session is removed as specified; retained named team rows follow the deletion policy.                    |

## Profile

| ID     | Test and steps                                                                                      | Expected result                                                                        |
| ------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| PRO-01 | Open A's public profile signed out and open A's private profile as B.                               | Public fields/projects load anonymously; private profile is 404 to B.                  |
| PRO-02 | Edit header, bio, links, contact email, and privacy; reload.                                        | Saved values persist; only intended public fields appear anonymously.                  |
| PRO-03 | Add, edit, delete, and reorder education, experience, and certifications.                           | Order and data persist; invalid dates/years are rejected.                              |
| PRO-04 | Replace skills with duplicates, different casing, and maximum-size input.                           | Normalized unique skills persist atomically; invalid/over-limit input is rejected.     |
| PRO-05 | B calls every A profile-write endpoint and requests a nonexistent section row.                      | No write occurs; response is 404 or the documented authorization code.                 |
| PRO-06 | Toggle A's profile private, then search/browse/direct-open as anonymous and B.                      | A and A's public projects disappear where privacy requires; owner still sees own data. |
| PRO-07 | Force profile API failure and empty sections in the UI.                                             | Error with retry differs from empty state; no mock profile is shown.                   |
| PRO-08 | Inspect public profile responses for birthday, phone, Auth0 ID, tokens, and private contact fields. | None appear.                                                                           |

## Projects and files

| ID     | Test and steps                                                                                             | Expected result                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| PRJ-01 | A creates a draft with every project field, metadata, technologies, tags, and links; reloads and edits it. | Exact values round-trip; draft is visible only to A.                                                      |
| PRJ-02 | Publish a public project; open it signed out and as B; edit then archive it.                               | Public detail and card show current data; status changes persist.                                         |
| PRJ-03 | Make a project private or leave it draft; request it/search for it as B and anonymous.                     | 404/direct omission as specified; no search, browse, tag, or suggestion leak.                             |
| PRJ-04 | B tries create/update/delete/file/team operations on A's project.                                          | Owner checks reject each operation; row and stored object are unchanged.                                  |
| PRJ-05 | Submit safe rich text and an XSS corpus (`script`, event handler, unsafe URL, SVG).                        | Safe markup survives; executable content is removed on write and cannot run in the browser.               |
| PRJ-06 | Add valid link, PDF, image, and video attachments; reorder/edit/delete.                                    | Type/URL/size rules hold; persisted order and deletion are correct.                                       |
| PRJ-07 | Request signed upload, upload allowed/oversized/wrong-type objects, then delete the owning row.            | Only valid objects attach; expired/foreign signatures fail; deleted objects are swept per storage policy. |
| PRJ-08 | List A's projects including drafts and accepted team projects; filter/sort and page.                       | Owner list has correct scope, count, ordering, and stable pagination.                                     |
| PRJ-09 | Delete a disposable project after confirmation; reload its detail and list.                                | It is absent; related data follows cascade rules; no ghost card remains.                                  |
| PRJ-10 | Open a public project from Explore as anonymous and click “Back to Projects”.                              | Public `/browse/projects` gallery opens without asking for login.                                         |
| PRJ-11 | Open A's own project and click “Back to Projects”.                                                         | A's personal `/projects` list opens.                                                                      |
| PRJ-12 | Simulate project API outage/unknown ID.                                                                    | Distinct retryable error/404 appears; no server 500 or misleading empty project.                          |

## Team collaboration and notifications

| ID      | Test and steps                                                                                    | Expected result                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| TEAM-01 | A searches for B, invites B, and inspects both accounts.                                          | Pending member appears to A; B sees invitation and unread notification exactly once.                      |
| TEAM-02 | B accepts; reload A/B profiles and project lists.                                                 | Accepted membership and public project appear in both relevant views; notifications update.               |
| TEAM-03 | B rejects, then A re-invites; try duplicate/concurrent invites.                                   | State transitions are valid; one member row/invite notification per accepted transition.                  |
| TEAM-04 | A adds/removes a named external teammate and removes B.                                           | Named row follows scope; B's accepted visibility disappears after removal.                                |
| TEAM-05 | Stranger C or wrong account reads/manages team or notification IDs.                               | Private rows are 404/inaccessible; no cross-account mark-read.                                            |
| TEAM-06 | Mark one and all notifications read; reload; compare bell count.                                  | Count and rows agree; actions are idempotent.                                                             |
| TEAM-07 | Use keyboard only to open team and notification dialogs, change decisions, and close with Escape. | All controls work; focus stays inside modal and returns to trigger.                                       |
| TEAM-08 | Open team/notification UIs on empty data and API failure.                                         | Empty state differs from error state; retry works; visitor sees no private bell.                          |
| TEAM-09 | Race invite/accept/remove requests and inspect audit/activity rows.                               | Invariants hold; no lost or duplicated transition; related notification/activity is committed atomically. |

## Discovery and dashboard

| ID      | Test and steps                                                                                        | Expected result                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| DISC-01 | Search public data for `ML`, `AI`, `Go`, `C#`, Armenian/Russian names, and case variants.             | Relevant people/projects found with stable order; short tokens and Unicode work.                                  |
| DISC-02 | Search empty, malformed punctuation, and no-match query; inspect URL and history.                     | Safe empty state, shareable URL, browser Back restores query; no login prompt.                                    |
| DISC-03 | Type rapidly, clear/retype, and choose a keyboard suggestion.                                         | No lost characters or stale result; arrow/Enter/escape behavior and combobox semantics work.                      |
| DISC-04 | Browse projects by category/status/sort and paginate, including zero results.                         | Filters remain in URL across pages; exact matching, stable pagination and correct empty state.                    |
| DISC-05 | Browse people by school/major/year and paginate, including zero results.                              | Filters match one education entry per person and do not leak private profiles.                                    |
| DISC-06 | Open a tag with spaces, `C#`, `CI/CD`, and unknown tag.                                               | Canonical tag and correct project/person counts; unknown tag is 404/noindex.                                      |
| DISC-07 | Compare anonymous search/browse/tag/suggestions with a fixture containing private/draft data.         | No private person/project or sensitive field appears in cards, facets, counts, or suggestions.                    |
| DISC-08 | Open public discovery pages and verify titles, canonical/noindex rules, and visitor address handling. | Search landing indexable; query pages not; no browser token; forwarded address is trusted only with proxy secret. |
| DISC-09 | Open A's dashboard after projects, team actions, and activity; then sign out.                         | Counts, recent items, stars, feed and links match A's rows; signed-out route redirects.                           |
| DISC-10 | Force API failure or no data on discovery/dashboard.                                                  | Error/retry differs from no results or zero stats.                                                                |

## GitHub and LinkedIn integrations

| ID     | Test and steps                                                                             | Expected result                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| INT-01 | Open integration status with credentials absent and with connected GitHub.                 | Clear unavailable/connected state; no token in response or browser.                                               |
| INT-02 | Start GitHub connect, return with valid state, then try forged/replayed/mismatched state.  | Only valid same-browser callback links; nonce expires and cannot be replayed.                                     |
| INT-03 | List GitHub repositories, search/page, encounter rate limit/outage.                        | Own repositories only; cursor works; errors are distinct from empty list and retry safely.                        |
| INT-04 | Import two selected repositories with preview/overrides.                                   | Exactly two draft projects; source badge and metadata/README follow documented mapping; duplicates are prevented. |
| INT-05 | Edit an imported project, publish it, then dry-run/apply re-sync.                          | User-edited fields remain; upstream-owned changes apply only when confirmed.                                      |
| INT-06 | Disconnect GitHub and try import/re-sync again; retry unsettled revocation.                | Connection is removed and grant revoked/clearly pending; no stored token is exposed.                              |
| INT-07 | Upload a real LinkedIn export ZIP, select a subset in preview, confirm, then upload again. | Only selected valid items persist; second import creates no duplicates.                                           |
| INT-08 | Upload malformed, traversal, bomb, oversize, and non-CSV ZIPs.                             | Stable safe error code; no unchecked write or partial profile import.                                             |
| INT-09 | Enter LinkedIn login and inspect allowed first-login prefill and card state.               | Only supplied OIDC fields prefill; card truthfully distinguishes login identity from export import.               |
| INT-10 | Use both import wizards by keyboard in all UI languages at 390/1440 px and both themes.    | Reachable controls, correct focus after steps/dialogs, no clipping, clean console/axe.                            |

## Utilities, localization, and release

| ID     | Test and steps                                                                                                                                         | Expected result                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| REL-01 | Generate/download résumé from A's profile, including empty and full sections.                                                                          | Valid readable PDF with only selected public/authorized content and correct Unicode.        |
| REL-02 | Trigger optional AI summary/tag suggestion with provider success, timeout, and rate limit.                                                             | User can edit result; failure degrades cleanly without blocking manual entry.               |
| REL-03 | Trigger team invite email with fake provider, retry, and bounce if email infrastructure is enabled.                                                    | Outbox commits with event, sends after commit once, retries safely, records failure.        |
| REL-04 | Switch English/Russian/Armenian and light/dark on public and protected pages; reload.                                                                  | Language/theme persist; text and `<html lang>` agree; dates/RTL-neutral layout stay stable. |
| REL-05 | Run browser smoke matrix (public pages, protected redirects, dialogs, 404) and audit axe/console/CLS at 390/1440 px.                                   | No severe accessibility, hydration, runtime, overflow, or material layout-shift defects.    |
| REL-06 | Run signed-in full journey A/B from sign-up through profile, project, team, search, import, dashboard, résumé, and account deletion on deployed stack. | Every v1 non-optional step succeeds across UI, API, DB, storage, and Auth0.                 |
| REL-07 | Repeat critical anonymous recruiter journey on deployment: search → public profile → public project → browse/tag.                                      | No login required, no private data, all public links lead to public pages.                  |
| REL-08 | Check production health/readiness, migration level, logs, TLS/storage config, and rollback procedure.                                                  | Deployment is ready, secrets remain private, and recovery path works.                       |
