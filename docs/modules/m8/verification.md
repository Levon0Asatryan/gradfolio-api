# M8 local implementation verification

Verified on 2026-10-20, against the API working tree based on `c153f58` and
frontend working tree based on `7bbe239`. These changes are local; no production
deployment or real email send was performed.

The user requested provider-independent email infrastructure with sending disabled
until a provider and domain are available. This is the implemented email scope.

## PR revalidation on current main

The implementation was rebased onto API `3cd6f54` and frontend `e0f3d53` before
publication. M7 changes are preserved. The additive email migration is `0012_email`,
after the existing deletion-tombstone and suggestions-notification migrations.

- API: 1,119 unit tests / 66 files; coverage statements 95.39%, branches 91.12%,
  functions 95.03%, lines 96.66%. ESLint, TypeScript, OpenAPI check, build and
  `db:types:check` passed.
- Frontend: 1,635 tests / 148 files; coverage statements 89.74%, branches 85.75%,
  functions 86.20%, lines 91.03%. ESLint, TypeScript, knip and production build
  passed. API snapshot matches byte for byte and pins API commit `0a80c0f`.
- Prettier passed on tracked files in both repositories. Unrelated untracked QA
  artifacts were excluded from the PRs. The npm hooks could not run on the host;
  their checks were run explicitly with npm in Docker instead.
- Full MySQL run: 1,026/1,028 passed, including every M8 HTTP/outbox test and the
  new migration's up/down preservation tests. The two failures were a pre-existing
  nonce expiry assertion comparing against the request start (5 ms discrepancy),
  and the full-schema round trip exceeding the local 20-second timeout. The nonce
  assertion now bounds issuance by the response time. Re-running both affected
  files passed all 71 tests, using a local `--testTimeout=60000` override; the
  full-schema round trip completed in 17.88 seconds. No production runtime or
  global test timeout was changed.

GitHub CI on the initial PR head passed static checks, unit coverage, the entire
MySQL integration suite and migration checks. Its container-stack smoke still
expected 18 application tables; migration 0012 correctly creates the nineteenth,
`email_outbox`. The smoke assertion is updated to 19 with this migration.

Manual review traced caller resolution, section/project allow-lists, SQL ownership,
transactional invite/outbox writes, leases/idempotency and template escaping.
Frontend review traced same-origin bounded input, server-only tokens, no-store
responses, localized failure handling and dialog/Settings controls. The rule corpus
and repository authorization/concurrency rules were checked. This was a manual
four-pass review, not execution of the agent review workflow.

Not verified: exhaustive guard-removal mutation tests, a signed-in deployed browser
journey, or real provider delivery/webhook/scheduling. These remain explicit
acceptance gaps; no deployed result is claimed. The evidence below records the
earlier implementation checks and remains historical rather than replacing this
current-main revalidation.

## Delivered

### Review corrections (2026-10-21)

- Dispatch now has an atomic `leased` to `dispatching` boundary. Cancellation can
  win before that transition; an in-flight send keeps its lease and provider result.
  Expired dispatches are retried only under the provider's deduplication guarantee,
  or recorded as uncertain. Barrier tests cover concurrent rejection and removal.
- Email and resume follow the role folders: DTOs, services, repositories, e2e and
  pure utils. Controllers contain no SQL. Font assets and coverage paths moved with
  the renderer. HTTP examples are split by module.
- The email language snapshot is documented; it stays stable across retries.
  OpenAPI states that projects are sorted newest first rather than by input ID order.
- Backend: all 1,119 unit tests and all 1,032 MySQL tests passed. The full local MySQL
  run used `--testTimeout=60000`; repository defaults are unchanged. Coverage remains
  95.39% statements, 91.12% branches, 95.03% functions, 96.66% lines. Lint, types,
  generated OpenAPI, build and DB type verification passed. Built-font smoke returned
  a 5,231-byte PDF from the new runtime path and found the bundled license.
- Removing the cancellation boundary in an isolated container made both new
  in-flight tests fail (`canceled` instead of `dispatching`). All 19 focused
  email/resume/migration tests pass without that mutation.
- Frontend: all 1,645 tests passed. Coverage is 89.88% statements, 85.95% branches,
  86.42% functions, 91.18% lines; lint, types, knip and production build passed.
  Six targeted assertions fail against the old implementation, proving the language,
  unsubscribe and project-limit regressions. UI and email language are independent;
  valid unsubscribe links remain retryable on transient errors; project selection is
  capped at 50; empty downloads are disabled; a missing project prompts a reload.

The production login journey was later completed by the user; real email
provider acceptance remains open.

| Item                     | Local result                                                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 Resume PDF           | Owner profile button, section/project selection, private/draft consent, server-side binary download, one template, en/ru/am, embedded font                                                                              |
| 8.6 Email infrastructure | Additive migration 0012, transactional outbox, mailer interface, disabled CLI, leases, bounded retries/timeouts, unknown-outcome quarantine, retention, internal bounce/complaint feedback                              |
| 8.7 Invitation email     | Enqueue with membership/notification/activity, rolling 24-hour cooldown, account-email verification separate from the badge, localized HTML/plain text, login-required `/teams` action, signed unsubscribe confirmation |
| 8.8 Preferences          | Owner-scoped GET/PATCH, Settings controls for invitation mail and language, failure states, public language/theme settings remain available when session lookup fails                                                   |
| 8.2–8.5                  | Stretch features remain deferred: AI, tag suggestions, full portfolio PDF, arbitrary-recipient email sharing                                                                                                            |

## Evidence

Tests ran in Node 24 Linux containers with MySQL **8.4.11**, a local JWKS tenant
and fake mailer. No external Auth0 account or email provider was needed. The
production image uses Node **24.22.0** and PDFKit **0.20.2**.

| Check                                                              | Observed result                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API format, ESLint, TypeScript, generated OpenAPI                  | PASS                                                                                                                                                                                                        |
| API unit coverage (`npm run test:coverage -- --maxWorkers=2`)      | **1,037 tests passed**, 61 files; statements 95.34%, branches 90.10%, functions 95.06%, lines 96.67%; all 90% gates met                                                                                     |
| M8 MySQL integration                                               | **13 tests passed**: 10 email and 3 resume tests                                                                                                                                                            |
| Full API integration run                                           | 880/883 passed initially. The three failures were the new string-column registry entries and two M7 migration tests assuming 0009 was last. Those were fixed and verified in the follow-up below.           |
| Migration/column follow-up                                         | **6/6 passed**: three pinned 0009 tests, column-registry equivalence, and two new 0010 tests. Proves preservation of existing accounts, safe defaults, idempotency and exact schema restoration on down/up. |
| DB generated types (`npm run db:types:check`)                      | PASS against the migrated MySQL database                                                                                                                                                                    |
| Frontend ESLint, TypeScript and knip                               | PASS                                                                                                                                                                                                        |
| Frontend unit coverage (`npm run test:coverage -- --maxWorkers=2`) | **1,453 tests passed**, 136 files; statements 89.74%, branches 85.94%, functions 85.91%, lines 90.98%; all configured gates met                                                                             |
| Frontend production build                                          | PASS, including `/api/resume`, email routes, dynamic Settings and the public unsubscribe page                                                                                                               |
| API production Docker build                                        | PASS; font and license copied into `dist/api/resume/utils/fonts/`                                                                                                                                           |
| Built-image disabled worker                                        | PASS: `{"processed":0,"disabled":true}` against the test DB                                                                                                                                                 |
| Built-image PDF                                                    | PASS as the image's non-root user: 20,715-byte, two-page A4 sample; embedded font and license present; both rendered pages visually inspected                                                               |

The PDF unit tests extract text using PDF.js and check Armenian/Cyrillic/Latin,
multiple pages, a clickable URL appearing once, and character/page/byte/time
bounds. The integration tests prove owner/other/anonymous access, exclusion of
private account fields and unselected sections, explicit private-project consent,
accepted public team projects and the dedicated PDF request budget.

Email tests prove rollback, concurrent invite/worker handling, the cooldown,
opt-out and verification checks, cancellation after an answer, account deletion,
definite failure retries, uncertain-outcome handling, stable keys/content after a
simulated crash, bounce suppression scoped to the destination, and signed-token
expiry/tampering/purpose/size checks. UI tests cover download selection/failure,
owner-only controls, preference failures, saved language and unsubscribe under
React Strict Mode without a GET mutation.

DB-dependent code is measured by real MySQL integration tests, following the
repository's existing unit coverage exclusions. The pure PDF, token and template
code remains in the unit coverage denominator. Coverage thresholds were not lowered.

## Environment notes

- An initial Windows bind-mounted run hit default five-second timeouts while
  loading dependencies. The final complete unit runs above used Linux filesystem
  snapshots and passed with the normal test timeout. The existing review-script
  tests also require `jq` and their tracked `.claude/workflows/*review.js` fixtures;
  both were provided in the test environment.
- The frontend's global `format:check` flags the pre-existing untracked
  `docs/qa-production-ui-2026-10-18.md`. All files changed for M8 were formatted and
  checked; that unrelated document was not edited.
- Local logs and the generated PDF sample are under the workspace's
  `tmp/m8-logs/` and `output/pdf/m8-resume-sample.pdf`.
- The frontend OpenAPI snapshot/types were regenerated from the current API
  working tree. Before a frontend PR, pin `openapi.source` to the API commit that
  includes M8; no commit was invented to label uncommitted source.

## 2026-10-23 Resend preparation

The user verified the signed-in production PDF download and Settings persistence
after API/FE PRs #119/#137 merged. Anonymous production `/readyz` and auth guards
also passed. This does not prove a real invite email. The Resend adapter, signed
webhook, OpenAPI update, worker image deploy hook and domain/runbook are now under
review. Resend sends remain disabled without a domain, account and secrets.

Local evidence: the complete API unit run passed **1,141 tests in 68 files**
(statements 95.44%, branches 91.86%, functions 94.90%, lines 96.78%). The
complete MySQL 8.4 integration run passed **1,037 tests in 61 files**, including
19 email integration tests. The new cases include raw signed bounce/complaint
delivery, replay, tampering, stale timestamp, wrong provider ID and retry
expiry. Windows bind-mounted Docker required longer test timeouts (30 seconds
for unit, 60 seconds for integration); no assertions or coverage gates changed.
TypeScript, ESLint, generated OpenAPI and changed-file formatting passed. The
production Docker image built successfully, and its compiled worker returned
`{"processed":0,"disabled":true}` against the migrated test database. PR and
production gates are recorded separately when complete.

## 2026-10-25 SendGrid revalidation

The user selected SendGrid instead of purchasing a domain. They confirmed Single
Sender verification and privately saved sending/API and signed-webhook keys.
The dashboard showed trial expiry on **2026-12-22**. Cloud secret installation,
worker creation, endpoint enablement and real provider delivery remain for Levon.
See [the deployment handoff](sendgrid-handoff.md).

- TypeScript, ESLint, generated OpenAPI and whole-repository Prettier passed.
- Full unit coverage: **1,159 tests in 69 files**; statements 95.36%, branches
  91.99%, functions 94.49%, lines 96.86%. Thresholds remain unchanged.
- Full MySQL 8.4 integration: **1,041 tests in 61 files**, including 23 email
  tests. New cases exercise real ECDSA signatures over raw HTTP bodies,
  bounce/spam suppression and replay, wrong provider IDs, uncorrelated provider
  test events, invalid/stale signatures and expired dispatch quarantine.
- Four isolated mutations (signature check, timestamp freshness, provider-ID
  comparison and expired-dispatch protection) each produced the expected
  assertion failure. The workspace was not mutated during these checks.
- Production Docker image built; its compiled worker returned
  `{"processed":0,"disabled":true}` against the migrated test database.
  A separately started API process in that image passed `/readyz`, rejected an
  unsigned webhook with 400 and accepted an ECDSA-signed provider test with 200.
  The initial 10-second startup allowance was too short on Docker Desktop;
  a 30-second readiness allowance passed without an application change.
- Linux Node 24 containers used 30-second unit and 60-second integration test
  timeouts for Windows bind-mount overhead. Logs are under `tmp/m8-logs/sendgrid-*`.

No actual SendGrid credential, private postal address or provider request body is
stored in the repository. No real provider send or GCP configuration change was
performed. CI, review and deployment results must be checked on the PR head.

## Production gates still open

The user changed the provider to SendGrid on 2026-10-23. Verify the account and
Single Sender for trial testing, provision sending credentials and the signed
Event Webhook key, then configure the Cloud Run worker and operational alerts,
and prove real delivery, idempotency/reconciliation, bounce and unsubscribe.
Delivery stays off until those checks pass. See [email.md](email.md) and the
[decision](email-decision.md) for the connection steps.

The user completed the signed-in PDF and Settings journey on production.
Repeat the invite/delivery journey after the SendGrid revision and sender are live.
The SendGrid trial is time-limited; record its expiry and a permanent delivery
decision before calling ongoing production email complete. See [sendgrid.md](sendgrid.md).
