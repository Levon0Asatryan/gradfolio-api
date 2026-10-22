# M8 implementation plan: resume PDF and team invitation email

Status: **local implementation verified** for resume PDF and preferences. Email
infrastructure is prepared with delivery disabled, as requested on 2026-10-20.
Provider/domain and production acceptance remain open. See
[verification.md](verification.md) and [email.md](email.md).

The design below was based on the checkout before implementation on 2026-10-20.
The implementation has since been rebased on main at 3cd6f54. Existing M7
changes are preserved, and the additive email migration is now 0012.

## 1. Scope and source of truth

| Tracker | v1 work                                                                                  | Acceptance             |
| ------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| 8.1     | Download a tailored resume PDF using one template and selected sections                  | REL-01                 |
| 8.6     | Transactional email outbox, provider adapter, delivery worker, retry and bounce handling | REL-03                 |
| 8.7     | Email registered users about team invitations, localized in en/ru/am                     | REL-03                 |
| 8.8     | Settings for invitation emails and their language                                        | Settings and REL-03/04 |
| 8.2–8.5 | **Stretch:** AI summary, tag suggestions, full portfolio PDF, share by email             | REL-02 only if enabled |

Sources: [tracker.md](../../tracker.md) M8 and Q10,
[feature-specification.md](../../reference/spec/feature-specification.md) §§4, 7, and
[test-cases.md](../../qa/test-cases.md) REL-01–03. The manually entered project
`summary` already exists and remains available without AI. An attachment of type
`pdf` is not a generated resume. Sharing a resume by email is not part of 8.1.

## 2. Existing seams and constraints

- `TeamWriteService.invite` changes membership, creates the in-app notification,
  and records activity in one `inTransaction` call. Re-invitation updates a
  rejected member row. Add the outbox write to that same transaction. Do not send
  from the transaction body: `inTransaction` can retry it after a deadlock.
- `users.email` is private and nullable. `users.verified` means verified email
  **or** connected GitHub, so it is not evidence that the email is verified.
  `contact_email` is a public profile field and must not be used for invitations.
- `GET /v1/users/:id` supplies profile sections and project summaries, but the
  owner can see private/draft projects there. Resume selection must not silently
  publish those. Existing visibility predicates protect public reads.
- Before M8, Settings stored the UI language in a cookie/local storage and had no
  email preferences. The API had no mailer, outbox, resume endpoint or PDF library.
  `RATE_LIMIT_AI` existed, with no AI endpoint using it.
- Current deployment is Vercel + Cloud Run + Cloud SQL MySQL 8.4, per
  [deploy.md](../../ops/deploy.md). The tracker still mentions Aiven in older M9 text.
  The migration runner requires additive migrations with down files and safe
  serving by the previous API revision during deployment.

## 3. Decisions to settle before implementation

| ID                    | Proposal                                                                                                                                                                                                                                                                                                                                                                                                           | Evidence or decision gate                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 PDF generator      | Trial PDFKit on the API with bundled, licensed fonts supporting Armenian, Cyrillic and Latin. Pin its tested version. Return bytes directly; do not store generated resumes in GCS.                                                                                                                                                                                                                                | In the first PR, render a two-page sample on Node 24 with the production container, extract text and inspect all three scripts. Keep PDFKit only if this passes; record a tested replacement otherwise. |
| D2 Resume privacy     | Authentication required; data from the caller's profile only. Default to public, published projects owned by or accepted-team-visible to the caller. The caller may explicitly select a private/draft **own** project, with a clear warning that the downloaded file contains it. Exclude login email, phone, birthday, Auth0 and integration data. Include public `contactEmail` only by explicit section choice. | Product review of selection copy and an owner/other/anonymous test matrix.                                                                                                                              |
| D3 Mail provider      | Choose a transactional provider and a verified sending domain with SPF, DKIM and DMARC. Store its credential in Secret Manager.                                                                                                                                                                                                                                                                                    | Before worker PR, verify the provider's API, idempotency/reconciliation capability, webhook signatures, bounce/complaint events, cost and region with a test account. Q10 leaves provider/domain open.  |
| D4 Duplicate delivery | Every outbox row has a stable delivery key. Retry with the **same** provider idempotency key, or reconcile an uncertain send by provider message ID before retrying. If neither is supported, mark the row `uncertain` and require operator resolution; do not blindly resend.                                                                                                                                     | Demonstrate a crash after provider acceptance but before DB acknowledgment. An outbox alone cannot prove “never send twice.”                                                                            |
| D5 Default preference | Existing and new users default to invitation email **on** and preferred language `en`; the Settings page explains both. Send only to an account email known to be verified.                                                                                                                                                                                                                                        | Confirm product default with Levon before migration. The API must track email verification separately from the existing `verified` badge.                                                               |
| D6 Unsubscribe        | The email link opens a confirmation page; a POST with a single-purpose opaque token turns invitation email off, without requiring login. No accept/reject action is embedded in an email link.                                                                                                                                                                                                                     | Test token expiry, replay, tampering, account deletion, link preview bots and safe redirection.                                                                                                         |

D3 and D4 are release gates for email delivery. The provider can be faked in
tests while these external decisions are pending; production sending cannot be
called complete until they pass.

## 4. Resume PDF, 8.1

1. Add `POST /v1/me/resume` with a strict request schema: selected section names,
   optional selected visible project IDs, and a flag for explicitly including
   private/draft projects. Bound array sizes, PDF pages, text length and render
   time through validated config. Response: `application/pdf`, attachment
   filename such as `gradfolio-resume.pdf`, `Cache-Control: private, no-store`.
   Apply a dedicated per-user PDF rate budget. Document the binary response in
   generated OpenAPI and regenerate frontend types.
2. Read the caller's profile, ordered education/experience/certifications/skills
   and chosen projects in one consistent DB snapshot. Project IDs are scoped to
   owned projects or accepted public/published team projects in SQL; a foreign or
   missing ID is a 404. Owner-only private/draft inclusion requires the explicit
   flag. Omit all unspecified sections. Map to
   a small resume DTO with an explicit field allow-list; never hand `UserRow` or
   raw rich HTML to the PDF renderer.
3. Render one restrained template: name/headline, optional public contact and
   links, optional bio, education, experience, selected projects, skills and
   certifications. Use text, not project HTML. Wrap long lines, paginate, embed
   the fonts, make links clickable only after URL validation, and set PDF metadata.
   Empty sections disappear without leaving blank pages. Bound generated bytes.
4. In the frontend, put “Download resume” on the owner's profile. Open a dialog
   with section toggles and project selection, show private/draft warnings, call
   the API through a server-side route/action so the Auth0 access token stays on
   the server, and deliver the blob as a browser download. Add en/ru/am copy and
   error/loading states. A non-owner sees no generation control.

**Proof:** empty and full profiles, mixed public/private/draft projects, a second
user's project ID, anonymous request, bad section/oversize, HTML-like text, long
unbroken words, en/ru/am names and mixed scripts. Verify `%PDF` and text extraction,
then visually inspect representative generated pages. REL-01 passes only when the
downloaded PDF is readable and contains exactly the chosen authorized content.

## 5. Email preferences and schema, 8.6–8.8

Use the next free migration number when implementation starts; do not assume
`0010` remains free. The additive up/down pair introduces:

- `users.preferred_language` (`en|ru|am`, default `en`),
  `users.team_invite_email_enabled` (default true), and a separate
  `users.email_verified` value that follows the Auth0 **email** claim. Set the
  email and its verification state together only when authenticated claims
  explicitly contain both; missing claims must not clear a known state. Never
  infer verification from `users.verified`. Backfill old rows as unverified
  until their next authenticated refresh or an authorized Auth0 lookup.
- `email_outbox`: immutable event ID and kind, recipient user ID, project ID,
  sanitized display-name/title snapshot, language snapshot, status, attempt count,
  next attempt, lease token/expiry, provider message ID, failure category and
  created/sent timestamps. Use a recipient FK with deletion behavior that
  suppresses pending work. Keep the destination address out of the payload and
  logs; resolve the current verified account email before sending. Add indexes
  for due work and `(project_id, recipient_user_id, created_at)` for the 24-hour
  invitation limit. A unique event key prevents duplicate enqueue.
- An opaque, hashed unsubscribe token record or equivalent one-purpose signed
  token; no email address in the URL. Any stored token hash expires. Account
  deletion removes/cancels pending delivery and token state.

Expose `GET/PATCH /v1/me/email-preferences` (`teamInvitesEnabled`,
`preferredLanguage`) with strict validation and owner scoping. Do not expose
internal outbox rows. Settings changes update the API and the UI language cookie
in one visible flow; on API failure, show an error rather than claiming the
email language changed. On sign-in, read the stored preference for the Settings
control. Retain existing anonymous language behavior.

## 6. Invitation enqueue and delivery, 8.6–8.7

1. In `TeamWriteService.invite`, after membership and notification succeed,
   inspect the invitee's email preference and separate email verification
   state. If eligible, check the latest invitation outbox event for this
   project/invitee under the existing project lock. Queue at most one event in
   any rolling 24-hour period. Re-invitation after rejection still produces an
   in-app notification immediately; after the cooldown it may queue a new
   email. External teammates have no account email and receive none.
2. Insert the outbox row in the **same** transaction as membership, notification
   and activity. A rollback leaves no email; a committed invite remains queued
   even when the provider is down. Store the inviter's display name, project
   title, `/teams` destination and template language as a bounded snapshot.
   The email has HTML and plain-text parts, both escaped/encoded, and a
   preference unsubscribe link. No email link accepts the invitation directly.
3. Add a `mailer` interface with a fake for tests and a provider adapter. A
   Cloud Run job/scheduled worker claims due rows using MySQL row locks and a
   lease, commits the claim, then calls the provider **after commit**. Multiple
   workers must not claim one row. On success, record provider message ID and
   `sent`. On temporary failure, retry with bounded exponential backoff and
   jitter; on permanent failure, mark failed and alert. An expired lease is
   retried only under D4's idempotency/reconciliation rule.
4. Just before sending, recheck recipient existence, verified email and current
   opt-out; cancel if any fail. Suppress delivery if the project/invitation no
   longer exists or is no longer pending. Use en/ru/am templates with the same
   data and a plain-text alternative. Provider outages do not break the invite
   HTTP response or the in-app notification.
5. Handle signed provider webhooks for bounced and complained messages. Match
   the provider message ID to a row; record status and suppress future sends to
   that recipient until the condition is resolved. Reject invalid signatures
   and ignore duplicate webhook events idempotently. Log row IDs, statuses and
   attempt numbers only, never addresses, tokens or provider response bodies.
6. Add an unsubscribe page and POST endpoint. The GET only presents a form
   (mail scanners may visit links); POST consumes a valid token and disables
   invitation email for that user. The `/teams` link requires normal login.

**Proof:** real MySQL 8.4 integration tests with two concurrent inviters/worker
claims, rollback after enqueue, re-invite within/after 24 hours, opt-out before
enqueue and before send, account/project deletion, no email/unverified email,
all three language templates, fake-provider timeout/5xx/4xx, worker crash after
acceptance, duplicate webhook, bounce and unsubscribe. Use barriers for races,
not sleeps. Inspect logs for address/token leakage. REL-03 passes with a fake
provider first; production acceptance additionally requires D3/D4 and a
verified-domain smoke send to test inboxes.

## 7. Delivery sequence and reviewable changes

| PR  | Repo    | Change                                                                                           | Gate                                                                              |
| --- | ------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| A   | api     | This plan; focused PDF renderer/font spike and provider capability check recorded in the plan    | Unicode and provider evidence; D3/D4 resolved before sending code                 |
| B   | api     | Resume DTO, snapshot query, PDF endpoint, OpenAPI, integration and render tests                  | REL-01 API matrix and `npm run verify`, `npm run test:int`                        |
| C   | fe      | Resume dialog/download, generated API types, locale text and browser test                        | Actual file downloads in en/ru/am; FE `npm run verify`                            |
| D   | api     | Additive migration, preferences API, outbox enqueue, worker/mailer, templates, webhook and tests | REL-03 matrix, migration up/down on MySQL 8.4, no duplicate send under crash test |
| E   | fe      | Email preferences and unsubscribe UI, locale text and tests                                      | API failure and opt-out round trip                                                |
| F   | ops/api | Domain DNS, provider secret/webhook, worker schedule and alerting; deploy and run smoke          | Verified delivery, bounce, logs, rollback                                         |

If the repository's usual milestone kit requires a plan PR before code, PR A is
plan only and its spikes are recorded as a short follow-up. Each frontend PR
pins the API OpenAPI revision before using the new operation. After the work,
write `docs/verification.md` with test commands, observed results, remaining
gaps and the deployed revision. Update `tracker.md` only after verification.

## 8. Stretch work after required acceptance

- **8.2 AI summary:** explicit per-project user action; source is description
  or imported README, never private data from another project. Add a provider
  adapter, timeout, output length bound, per-user/route budget, cost cap and
  safe plain-text output. Show a preview, let the user edit it, then save only
  with an owner-scoped write to `ai_summary`; manual `summary` retains priority.
  Provider failure leaves manual editing available. Test success, timeout,
  invalid output, rate limit and second-user 404 before enabling REL-02.
- **8.3 Tag suggestions:** return candidate tags from the owner's description;
  do not write tags until the user accepts them. Reuse the project's normalized
  tag rules and cap the number suggested.
- **8.4 Full portfolio PDF:** separate template and explicit limits for many
  projects/media; reuse authorization and font work from 8.1.
- **8.5 Share by email:** only after 8.6–8.8 operate reliably. Separate consent,
  recipient validation, abuse limits and public-link checks are required. Never
  email a private project link as if a recipient can open it.

These do not block M8's required exit: REL-01 and REL-03 pass, Settings works,
and the production email gate is satisfied. M9 owns the full deployed journey.
