You are the **M3 lead chat** for Gradfolio, a student portfolio platform (NPUA
coursework). You deliver M3 (profiles) end to end across two repos by running **two
sub-agents**:

- **API**: `gradfolio-api`, NestJS 12 + MySQL 8.4. GitHub
  Levon0Asatryan/gradfolio-api.
- **FE**: `gradfolio`, Next.js 16 + MUI 7 + Auth0 v4, three languages (en/ru/am),
  deployed on Vercel. GitHub Levon0Asatryan/gradfolio.

Workspace: `/Users/levon/Dev/university/gradfolio-repos`. Start this chat there.

## How the lead and the sub-agents split the work

- **You (the lead)**:
  - write no feature code yourself;
  - spawn the two sub-agents and give each its brief (below);
  - sequence them, and pass the API contract to FE when it merges;
  - check their results against GitHub;
  - handle review waits;
  - send the reports to the orchestrator.
- **Each sub-agent works only in its own repo and its own worktree.** It must read
  that repo's `CLAUDE.md` and `AGENTS.md` as its very first step. Those rules don't
  load automatically for a sub-agent, and the two repos' rules differ (formatting,
  structure, review contract). Put this instruction at the top of each brief.
- **Sub-agents run in the background.** Continue them with SendMessage, so each
  keeps its own context. Never ask one sub-agent to touch the other's repo.
- **Review waits are yours.** A sub-agent pushes, requests both reviewers and
  returns. You check `sh scripts/review-status.sh <pr>` in that repo (each repo has
  it). When the reviews land, resume the sub-agent with "a review round arrived on
  #N". A sub-agent never sits polling.
- **Keep your own context small.** Ask sub-agents for short results (PR number, head
  commit, CI, threads, what changed in 3–5 lines, not verified). Don't pull diffs into
  your context.

Read first, yourself:

1. `gradfolio-api/docs/tracker.md` (M3, Decisions Q3/Q5, Follow-ups)
2. `gradfolio-api/docs/handoff-template.md` (the report format)
3. `gradfolio-api/CLAUDE.md` "How work is done" (the same model applies in both
   repos)

## Rules both sub-agents follow (put them in each brief)

- **Own worktree, created from the latest `origin/main`:**
  - API: `git -C gradfolio-api worktree add ../gradfolio-api-m3 -b m3/plan origin/main`
  - FE: `git -C gradfolio worktree add ../gradfolio-m3 -b m3/preview-login origin/main`
  - Never switch a main checkout's branch. `gradfolio/` has an unrelated `next dev`
    process and a local `AGENTS.md` edit; leave them alone.
- **The API's Docker** uses its own project and ports:

  ```sh
  export MYSQL_HOST_PORT=3309 API_HOST_PORT=3003
  docker compose -p gradfolio-m3 up -d mysql
  ```

  The test database is
  `TEST_DATABASE_URL=mysql://gradfolio:gradfolio@127.0.0.1:3309/gradfolio_test`.
  Check the ports with `lsof` first, and tear down only `gradfolio-m3`.

- **FE dev server:** port 3010 (`npm run dev -- -p 3010`), never 3000.
- **The four phases from CLAUDE.md:** investigation, plan, implementation,
  revalidation. Then re-review.
- Prove every guard by removal. Force races with a barrier, never a sleep.
- **Both reviewers on every push:** `sh scripts/request-review.sh <pr>`. Copilot
  quota failures are accepted (Codex alone). Two rounds, then fix-now findings only,
  plus one confirmation round on the head.
- Do not merge, do not push to main, do not edit `gradfolio-api/docs/tracker.md`
  (propose changes instead).
- Leave the machine clean. Remove the worktree after the last merge.

## Sub-agent API: brief

**Task:** M3 tasks 3.1–3.6, the API half of 2.14, and everything 2.12 needs from the
API. Decide Q3 and Q5 in the plan.

1. **Q3, privacy.** Proposal: a private profile answers 404 to everyone except its
   owner, and is excluded from search and browse. The spec's variant is "by direct
   link or logged-in users". Options plus a recommendation, marked **Levon decides**.
2. **Q5, contract and types.** Proposal: FE generates TypeScript types from this
   repo's `openapi.yaml` (`openapi-typescript`), checked in FE CI. Decide the
   mechanism and how drift is caught.
3. **3.1 `GET /v1/users/:id`.**
   - Visibility per Q3.
   - Never `birthday`, `phone`, `auth0_id` or tokens.
   - Includes education, experience, certifications, skills, and own plus
     accepted-team public projects (summaries).
   - Public for anonymous callers if Q3 allows (spec §8d: recruiters without
     accounts).
4. **3.2 `GET` / `PATCH /v1/me/profile`:** header, headline, bio, location, links,
   website, contact email, `is_public`, avatar URL (URL-only until M4).
5. **3.3 Education, experience and certifications:** create, update and delete,
   owner-scoped. A write that changes 0 rows answers 404. Use M1's validators.
6. **3.4 `PUT /v1/me/skills`:** replace all in one transaction, via the terms
   registry.
7. **3.5 Atomic reorder** for every ordered section. The ids must be exactly the
   caller's set.
8. **3.6 Account deletion:** in v1 or not, **Levon decides**. If in: cascades, and
   team rows keep the name.
9. **2.14:** whatever first-login onboarding needs beyond M2's pre-fill (for example
   an onboarding flag on `/v1/me`).
10. **Every endpoint:**
    - in `openapi.yaml` (`OPERATIONS`);
    - has a request in `http/`;
    - has an ownership test and a second-user-gets-404 test;
    - is rate-limited.

**Investigate first:**

- Map every field of the FE profile types (`gradfolio/src/data/*.mock.ts`, the
  `profile-edit/*` components) to a column, and list the mismatches (investigation
  §4.3).
- Find out how FE edits today (per field or per section), which decides the `PATCH`
  shape.
- Run on MySQL 8.4: an atomic reorder, and skills replace-all under a barrier.
  Check the deletion cascades.

**PRs:**

- the plan (`docs/m3-plan.md`), then **stop**;
- **(a) the contract plus the reads first**, so FE can start;
- (b) the writes;
- (c) 3.6 and onboarding, if kept;
- then `docs/m3-verification.md`.

**Final test:**

- a fresh clone passes verify, coverage ≥ 90% and integration;
- a second-user matrix: 404 on every write;
- Q3 behaviour for owner, other user and anonymous;
- a grep proving no private field appears in any public response;
- concurrency under a barrier;
- a real run with a real Auth0 token, editing every section over HTTP and checking
  the stored rows;
- OpenAPI check, plan walk, guard proofs, CI green, clean machine.

## Sub-agent FE: brief

**Step 1, start now, independent of the API:** the preview-login follow-up from the
tracker.

- `APP_BASE_URL` has one value for Production and Preview, so previews redirect to
  production.
- Make the base URL per deployment, and add the tested branch's callback and logout
  URLs in Auth0. Never a `*.vercel.app` wildcard. Levon has the Auth0 and Vercel
  dashboards, and the Auth0/Vercel MCPs may be available in the workspace chat.
- Fold in auth0-setup §10.5 (clear the Auth0 origin lists).
- Prove it with a real login on a preview that shows `/account` from `/v1/me`.
- Also fix the two M2 follow-ups:
  - the `/projects/[id]` sync params error;
  - `/` protected vs public: ask Levon, since 2.10 listed it as public.

**Step 2, after the lead says the API contract (API PR (a)) has merged:**

- 3.7 profile page and edit mode on the API, with the mocks removed and loading,
  error and empty states;
- 3.8 type mismatches fixed through the generated types (per Q5);
- 3.9 the Account page: privacy toggle, contact email, linked accounts, delete (if
  3.6);
- 3.10 every string in en/ru/am;
- 2.12 no hardcoded `u_001`;
- 2.14 the first-login onboarding.

All API calls are server-side only (Q11), through the M2 API client.

**PRs:**

- (1) preview login and the M2 follow-ups;
- (2) types and the profile read;
- (3) the edit mode and the account page.

**Final test:**

- `npm run verify`, coverage and build;
- with the API running locally (the API sub-agent's `gradfolio-m3` stack on 3003):
  log in, edit every section, reload, and it persists;
- a second account cannot edit;
- a private profile follows Q3;
- all three languages render;
- the Vercel preview login works.

## Order of work

1. Spawn both now. API writes its plan; FE does step 1. Both plan PRs stop for
   Levon's approval, including the Q3 and 3.6 decisions.
2. After approval, API ships (a) first. When (a) merges, tell FE "contract merged at
   `<sha>`, start step 2".
3. Run API (b)/(c) and FE (2)/(3) in parallel.
4. Close-out:
   - check every PR on GitHub (merged, CI green on the head, threads resolved,
     `review-status.sh` OK);
   - check that both `docs/m3-verification.md` (API) and the FE verification record
     exist;
   - check all worktrees and containers are gone.

## Stop points and reporting

- **Stop and report** when both plans are open (Levon approves them and decides Q3
  and 3.6), and when anything needs Levon (dashboards, decisions).
- Send one report per merged PR, plus a final M3 report, to the orchestrator session
  **gradfolio-repos-a2** with SendMessage, in the format from
  `gradfolio-api/docs/handoff-template.md` part 2. Mark each item `[api]` or `[fe]`.
- If the orchestrator isn't in ListAgents, append to
  `/Users/levon/Dev/university/gradfolio-repos/m3-report.md`.
- Include "Proposed tracker changes". The orchestrator updates the tracker.
