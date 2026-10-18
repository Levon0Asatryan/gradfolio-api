You are the **M6 lead chat** for Gradfolio, a student portfolio platform (NPUA
coursework). You deliver M6 (discovery and dashboard) end to end across two repos by
running **two sub-agents**:

- **API**: `gradfolio-api`, NestJS 12 + MySQL 8.4. GitHub
  Levon0Asatryan/gradfolio-api. Live on Cloud Run: every merge to `main` deploys to
  production, and the migrate job runs first.
- **FE**: `gradfolio`, Next.js 16 + MUI 7 + Auth0 v4, three languages (en/ru/am),
  on Vercel. GitHub Levon0Asatryan/gradfolio. Every merge to `main` deploys to
  production.

Workspace: `/Users/levon/Dev/university/gradfolio-repos`. Start this chat there.

## How the lead and the sub-agents split the work

Same model as M3–M5:

- **You (the lead):**
  - write no feature code yourself;
  - spawn the two sub-agents, each with its brief;
  - sequence them, and pass the contract to FE when it merges;
  - check results against GitHub;
  - own the review waits;
  - send the reports.
- **Each sub-agent works only in its own repo and worktree.** Its first step is to
  read that repo's `CLAUDE.md` and `AGENTS.md`, which don't load automatically for a
  sub-agent. Put this at the top of each brief.
- **Sub-agents run in the background.**
  - Continue each one with SendMessage.
  - Never ask one to touch the other's repo.
- **Review waits are yours.**
  - A sub-agent pushes, requests both reviewers and returns.
  - You poll `sh scripts/review-status.sh <pr>`, then resume it with "a review round
    arrived on #N".
- **Keep your context small:** PR number, head, CI, threads, 3–5 lines of change, and
  what isn't verified.
- **Other chats (M7/M8) may run at the same time.** Touch only your own worktrees,
  branches (`m6/*`), Docker project and ports.

Read first, yourself:

1. `gradfolio-api/docs/tracker.md`:
   - M6;
   - Decisions Q3;
   - Issue coverage S8, S9, P3, F4;
   - Follow-ups.
2. `gradfolio-api/docs/investigation.md`: D3 and D4 (FULLTEXT minimum token size,
   case-sensitive `JSON_CONTAINS`).
3. `m4-report.md` and `m5-report.md` in the workspace: open follow-ups, and what went
   wrong.
4. `gradfolio-api/docs/m5-plan.md`: activities (the dashboard feed reads them).
5. `gradfolio-api/docs/deploy.md` and `docs/handoff-template.md`.
6. `manual-testing.md` in the workspace: Levon's queue (see "Levon's queue" below).

## Merging (Levon's standing order from M5)

The lead merges a PR only when **all** of these hold on its **current head**:

- Codex has reviewed that head and left no unresolved findings (Copilot quota
  failures are accepted);
- CI is green;
- every thread is resolved.

Docs-only PRs follow the same rule.

Never merge before the review round lands. In M4 and M5 that happened several
times, and each time the fixes had to come in later PRs.

**Merge order:** an FE PR that calls a new endpoint merges only after that API PR has
merged and the Deploy workflow is green (`/readyz` 200).

Never push to `main`. Never edit `gradfolio-api/docs/tracker.md`; propose changes
instead.

## Levon's queue

`/Users/levon/Dev/university/gradfolio-repos/manual-testing.md` holds everything only
Levon can do: a login, a token, a dashboard click, a decision.

- **Add a row** (`M6-T1`, `M6-T2`, …) for each such item. Give:
  - the exact steps;
  - the time it takes;
  - who continues afterwards;
  - the document it fills in.
- **Agents first run every check that needs no login themselves**, so a row holds only
  the logged-in remainder.
- **Put the IDs in your report.**
- **Never ask for or accept passwords in chat.** Test accounts log in by hand in a
  headed browser. Tokens go in a gitignored `.env`.

## Lessons from M3–M5: apply them

- **The real-token run is mandatory.** It found real bugs in M3 (API #37), M4 (FE
  #64, a 500 on every project page in production) and M5.
- **Playwright found what unit tests missed:** dialog focus (M5 #75) and a hydration
  mismatch (M5 #80). Use it on every changed page.
- **Production differs from local.** Vercel has no `require(esm)` (M4 #64), and the
  server has Armenian locale data while Chromium doesn't (M5 #80). Run the deployed
  site after each FE merge.
- **Review receipts state their method honestly.** Never commit `node_modules` or
  symlinks (M5 #58).

## Rules both sub-agents follow (put them in each brief)

- **Own worktree, from the latest `origin/main`:**
  - API: `git -C gradfolio-api worktree add ../gradfolio-api-m6 -b m6/plan origin/main`
  - FE: `git -C gradfolio worktree add ../gradfolio-m6 -b m6/plan origin/main`
- **API Docker:** its own project and ports. Check them with `lsof` first, and tear
  down only `gradfolio-m6`.

  ```sh
  export MYSQL_HOST_PORT=3314 API_HOST_PORT=3008
  docker compose -p gradfolio-m6 up -d mysql
  ```

  The test database is
  `TEST_DATABASE_URL=mysql://gradfolio:gradfolio@127.0.0.1:3314/gradfolio_test`.

- **FE dev server:** `npm run dev -- -p 3012`.
- **Work method:**
  - the four phases from CLAUDE.md, then re-review;
  - prove every guard by removal;
  - force races with a barrier, never a sleep.
- **Both reviewers on every push** (`sh scripts/request-review.sh <pr>`). Two
  rounds, then fix-now only, plus one confirmation round on the head.
- **Migrations deploy to production on merge.** Each one must be:
  - additive, and safe while the previous revision serves;
  - applied twice in CI with nothing left the second time;
  - checked with `down` then `up` giving an identical schema;
  - a FULLTEXT index added online, with its build time measured on a realistic
    seed.
- **Vercel previews use the production API and database.** Use test data only, and
  delete it afterwards.
- **Leave the machine clean:** remove worktrees, Docker stacks, sessions and tokens
  after the last merge.

## Sub-agent API: brief

**Task:** M6 tasks 6.1–6.5. 6.6 (view counting) and 6.7 (similar projects/people)
are stretch: the plan recommends in or out, and **Levon decides**.

1. **6.1 global search**, grouped into people and projects.
   - **Public content only:** Q3 = A through the existing visibility helpers
     (`projectVisibleTo` and the profile rule). Accepted team projects count;
     drafts, private and pending items never do.
   - **FULLTEXT plus a fallback for short tokens** (`AI`, `ML`, `Go`, `C#`, `UI`; S8).
     Cloud SQL's `innodb_ft_min_token_size` is 3, so compare:
     - a fallback query (prefix `LIKE` on terms, or the terms registry);
     - changing the flag on Cloud SQL (needs a restart and an index rebuild: cost and
       downtime);
     - the ngram parser.
       Run each on MySQL 8.4; don't recall.
   - **Armenian and Russian** names and titles must be found: test the tokenizer and
     collation with real Armenian and Cyrillic text, including case and ё/е.
   - Ranking and pagination stable, with input limits (length, characters).
2. **6.2 tag search and tag pages:** projects and people for a skill or technology,
   **case-insensitive** (S9: `JSON_CONTAINS` is case-sensitive). Use M1's terms
   registry (canonical terms), not JSON scans.
3. **6.3 browse:**
   - projects: sort newest, by category, and most viewed only if 6.6 is in;
   - users: filter by school, major and graduation year, from education;
   - validated parameters, stable pagination, an index for every sort and filter
     (show `EXPLAIN`).
4. **6.4 tag cloud** (skills plus technologies, public content only), with counts.
   Cheap enough to serve on every page view, or cached with a stated staleness.
5. **6.5 dashboard** for the caller:
   - counts, recent projects, the activity feed (M5's activities), recent activity
     count;
   - drop `githubStars` (M7 data) and `linkedinConnections` from the contract, or keep
     them as `null` until M7: decide and document it (F4);
   - the feed never shows another user's private data.
6. **Anonymous traffic and rate limits.**
   - Search, browse and tags are public (the §8d recruiter path), so they need
     limits that stop scraping.
   - **Known problem:** every anonymous FE request reaches the API from the Next.js
     server's address, so all anonymous users share one rate-limit bucket (an M3
     follow-up).
   - Propose a fix and **Levon decides**, for example:
     - the FE forwards the client IP in a header the API trusts only with a shared
       secret (in Secret Manager and Vercel, never in the repo);
     - or per-route limits sized for that.
7. **Performance:**
   - a seed of about 1,000 users and 3,000 projects (en/ru/am text) for local
     measurement;
   - p95 latency for search, browse and dashboard on the local stack;
   - `EXPLAIN` for every new query;
   - no N+1 queries (assert the query count in tests).
8. **Every endpoint:**
   - in `openapi.yaml`;
   - has a request in `http/`;
   - has a test proving private, draft and pending content never appears (plus an
     ownership/second-user test where the caller matters);
   - is rate-limited.

**Investigate first:**

- Current indexes on `users`, `projects` and the term tables;
- what the FE search page and dashboard expect (types, mock fields);
- MySQL 8.4 runs of the FULLTEXT options above, with Armenian/Cyrillic samples;
- the Cloud SQL flag cost.

**PRs:**

- the plan (`docs/m6-plan.md`), then **stop**: Levon decides the short-token method,
  6.6/6.7, the dashboard fields and the rate-limit fix;
- (a) the contract plus search and tags;
- (b) browse and the tag cloud;
- (c) the dashboard;
- then `docs/m6-verification.md`.

**Final test:**

- a fresh clone passes verify, coverage ≥ 90% and integration;
- **the search matrix:**
  - "IoT", "ML", "AI", "Go", "C#", an Armenian name, a Russian name, and mixed case;
  - each finds what it should, and private, draft and pending content never appears
    (owner, other user, anonymous);
- a grep proving no private field appears in public responses;
- p95 numbers and `EXPLAIN` output recorded;
- **the real-token run** (with a queue row for Levon): the dashboard for a real
  account matches its stored rows;
- **production after deploy:**
  - `/readyz` 200;
  - an anonymous search and a tag page;
- OpenAPI check, plan walk, guard proofs, CI green, clean machine.

## Sub-agent FE: brief

**Step 1, now, independent of the API:** open follow-ups, as one or two small PRs:

- the `/projects` hydration mismatch in Armenian (same date-format cause as M5 #80);
- the token-set persist error ("Failed to persist the updated token set") when an
  access token expires on a server-rendered page;
- duplicate invite notification rows both showing Accept and Decline until reload;
- the signed-out sidebar prefetch of protected links, which redirects into Auth0 and
  logs a CORS error (M4 F3: `prefetch={false}` or a 401);
- the not-found page's layout shift of 0.172 at 1440 (M4 F4).

Then **the FE plan** (`docs/m6-plan.md`), then **stop**:

- **6.8 the search page on the API:**
  - keep or drop the client-side "Developers/Designers…" heuristic;
  - clickable tags lead to tag pages;
  - grouped results;
  - empty, error and loading states;
  - the query in the URL, so a search can be shared;
- **6.9 new pages:**
  - the browse-projects gallery (filters, sort, pagination or infinite scroll: pick
    one and give the reason);
  - the browse-users directory;
  - tag pages;
- **6.10 the dashboard on the API**, with `dashboard.mock.ts` deleted and the
  activity feed rendered from i18n keys;
- **SEO for public pages:**
  - metadata, Open Graph data and canonical URLs for search, tag and browse pages;
  - private content is never indexed.

**Step 2:** after API (a) is live, search and tags. After API (b), browse and the tag
cloud. After API (c), the dashboard.

**Every string in en/ru/am. All API calls server-side only (Q11).**

**Playwright** (it's in the repo since M4 #63):

- **Setup:** browsers in
  `PLAYWRIGHT_BROWSERS_PATH=/Users/levon/Dev/university/.sandbox/ms-playwright`.
- **Every changed page:**
  - 390 and 1440, light/dark, en/ru/am;
  - axe with 0 serious or critical violations;
  - no console errors, hydration warnings or layout shift (CLS < 0.1);
  - a keyboard walkthrough of the search box, the filters and the results.
- **Add specs for the anonymous paths** (search, tag page, browse), so they run in CI
  without a login.
- **Logged-in runs:**
  - a headed login by Levon (a queue row);
  - `storageState` in the scratchpad, deleted afterwards;
  - never script credentials.

**PRs:**

- (1) the follow-ups;
- (2) the plan;
- (3) search and tags;
- (4) browse and the tag cloud;
- (5) the dashboard;
- then the FE M6 verification record.

**Final test:**

- `npm run verify`, coverage, build, and the Playwright suite;
- the search matrix (above) through the UI, anonymous and logged in;
- the dashboard numbers match the API for the test account;
- the deployed site after each merge: anonymous search, tag and browse pages, and the
  logged-in dashboard (via the queue row).

## Order of work

1. **Spawn both now.**
   - API writes its plan.
   - FE does step 1, then its plan.
2. **Stop for Levon:** the short-token method, 6.6/6.7, the dashboard fields, the
   rate-limit fix, and FE's pagination choice.
3. **API (a) → (b) → (c)**, each deployed before the matching FE PR merges.
4. **Close-out:**
   - every PR merged per the rule above;
   - both verification docs;
   - production `/readyz` 200;
   - queue rows up to date;
   - machine clean.

## Reporting

- **Write each report to
  `/Users/levon/Dev/university/gradfolio-repos/m6-report.md`**, in the format from
  `handoff-template.md` part 2:
  - one entry per merged PR, plus a final M6 report;
  - items marked `[api]` or `[fe]`;
  - "Proposed tracker changes";
  - the queue IDs.
- Also send a short pointer to the orchestrator `gradfolio-repos-d8` with
  SendMessage. Messages to it have been held and expired, so the file is the record.
