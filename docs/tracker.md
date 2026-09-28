# Tracker

Status of record. The orchestrator updates it after validating a worker's
report; workers propose changes in their report rather than editing it, so two
chats never edit it at once.

Last updated: 2026-09-28, by the orchestrator, after bootstrap #1 and #2 merged.
`main` is at `fbdf0e0`; no CI yet.

## Now

- **Bootstrap:** #1 conventions (`CLAUDE.md`, `AGENTS.md`, handoff template) and
  #2 push gates + `.review/` + `gradfolio-review` skill — merged. #3 this tracker
  + `docs/investigation.md` — in review.
- **Next: M0** — architecture plan. Handoff:
  `/Users/levon/Dev/university/gradfolio-repos/m0-prompt.md`.
- **Merge gate:** merge a code PR only after the reviewer has reviewed or 👍'd
  the head SHA and the orchestrator has validated. Docs-only PRs skip the wait.

## Milestones

Proposed order; the M0 plan confirms or reshapes it.

| Milestone | Name | Status | Plan | Verification |
| --- | --- | --- | --- | --- |
| M0 | Architecture decisions (Q1–Q10) + walking skeleton: stack, commands, hooks, CI, MySQL 8.4 integration tests, token verification, first-login provisioning, `GET /me` | next | — | — |
| M1 | Profiles: public profile read (visibility, private fields), own profile + sections edit, reorder | — | — | — |
| M2 | Projects: CRUD, attachments, `description_html` sanitizing, privacy | — | — | — |
| M3 | Teams + notifications: invite/accept/reject, teammate projects on profile | — | — | — |
| M4 | Discovery + dashboard: search, browse, tags, activities, stats | — | — | — |
| M5 | GitHub integration: OAuth link, encrypted tokens, repo import | — | — | — |
| M6 | Utilities (scope TBD): AI summary, resume PDF, email share | — | — | — |

Frontend wiring (`gradfolio` repo) per milestone or as its own track — decide in M0.

## Follow-ups

Kinds: fix · decide · process. Every deferred review finding becomes a row.
IDs refer to `/Users/levon/Dev/university/gradfolio-repos/issues.md`.

| Source | Item | Kind |
| --- | --- | --- |
| investigation Q1–Q10 | Stack, schema ownership, privacy, team model, API contract, storage, provisioning, integrations scope, hosting/test DB, AI/PDF/email | decide (M0) |
| issues S1 | `gradfolio-sql` compose crash-loops on fresh volume (`queries.sql` runs before `schema.sql`) | fix (gradfolio-sql) |
| issues S2, S13 | `gradfolio-sql` docs: "omit id on insert", "GENERATED ALWAYS" comment, "12 tables" — all wrong | fix (gradfolio-sql) |
| issues S3–S6 | `queries.sql` missing ownership/visibility/transaction — must not be copied into the API as-is | fix (gradfolio-sql) |
| issues S11–S12 | Seed: owner-as-member inconsistent; notification links use mock ids | fix (gradfolio-sql) |
| issues F1–F6 | Frontend: regex sanitizer, fail-open middleware, hardcoded `u_001`, type mismatches, image allowlist, doc drift | fix (gradfolio) |
| bootstrap | Git hooks not installed — M0 skeleton picks the hook manager and wires pre-commit / pre-push | process |
| bootstrap | Levon's setup (kit §9): Codex app on repo, Dependabot, **auto-delete head branches (currently off)**, `/reload-skills` after #2 merges | process |
