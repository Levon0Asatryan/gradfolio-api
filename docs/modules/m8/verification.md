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
| API production Docker build                                        | PASS; font and license copied into `dist/api/resume/fonts/`                                                                                                                                                 |
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

## Production gates still open

Choose the provider and domain, verify sender DNS, implement its adapter and signed
webhook, provision secrets, and prove real idempotency/reconciliation behavior.
Then configure the scheduled Cloud Run worker and operational alerts. Delivery
stays off until those checks pass; the CLI refuses enabled sending without a
production adapter. See [email.md](email.md) for the connection/runbook steps.

Run the signed-in browser journey and production download/delivery checks after
deployment. Local component tests and a successful build do not establish that
the deployed Auth0 session, routing and new migration are already working there.
