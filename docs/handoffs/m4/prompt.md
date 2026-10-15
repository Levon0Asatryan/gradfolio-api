You are the **M4 lead chat** for Gradfolio, a student portfolio platform (NPUA
coursework). You deliver M4 (projects and media) end to end across two repos by
running **two sub-agents**:

- **API**: `gradfolio-api`, NestJS 12 + MySQL 8.4. GitHub
  Levon0Asatryan/gradfolio-api. Live on Cloud Run; every merge to `main` deploys
  to production (the migrate job runs first).
- **FE**: `gradfolio`, Next.js 16 + MUI 7 + Auth0 v4, three languages (en/ru/am),
  on Vercel. GitHub Levon0Asatryan/gradfolio. Every merge to `main` deploys to
  production.

Workspace: `/Users/levon/Dev/university/gradfolio-repos`. Start this chat there.

## How the lead and the sub-agents split the work

Same model as M3:

- **You (the lead):**
  - write no feature code yourself;
  - spawn the two sub-agents, each with its brief below;
  - sequence them, and pass the API contract to FE when it merges;
  - check their results against GitHub;
  - own the review waits;
  - send the reports.
- **Each sub-agent works only in its own repo and worktree.**
  - Its first step is to read that repo's `CLAUDE.md` and `AGENTS.md`; they don't load
    automatically for a sub-agent. Put this at the top of each brief.
- **Sub-agents run in the background.**
  - Continue each one with SendMessage, so it keeps its own context.
  - Never ask one to touch the other's repo.
- **Review waits are yours.**
  - A sub-agent pushes, requests both reviewers and returns.
  - You poll `sh scripts/review-status.sh <pr>`, then resume it with "a review round
    arrived on #N".
- **Keep your context small:** short results only (PR, head, CI, threads, 3–5 lines
  of change, not verified).

Read first, yourself:

1. `gradfolio-api/docs/tracker.md`:
   - M4;
   - Decisions Q3, Q5, Q6;
   - the UI track;
   - Follow-ups.
2. `gradfolio-api/docs/m3-plan.md` and `m3-verification.md`: the shape to repeat.
3. `gradfolio-api/docs/deploy.md`: how a merge reaches production.
4. `gradfolio-api/docs/handoff-template.md`: the report format.
5. `m3-report.md` in the workspace: what went wrong in M3, listed below.

## Lessons from M3: apply them

- **No PR is "ready for Levon" before its review round is done** on the head. In M3,
  FE #31 merged before its round, and its fixes had to move to #32/#33.
- Never request reviews on a merged PR.
- Review receipts must state their method honestly: a self-review is a self-review.
- **The real-token run found a real bug** (email shown as name, API #37), so it stays
  mandatory.
- **Merge order:** an FE PR that calls a new endpoint merges only after that API PR
  has merged **and** the Deploy workflow on `main` is green (`/readyz` 200). The
  production frontend must never call an endpoint that isn't live yet.

## Rules both sub-agents follow (put them in each brief)

- **Own worktree, from the latest `origin/main`:**
  - API: `git -C gradfolio-api worktree add ../gradfolio-api-m4 -b m4/plan origin/main`
  - FE: `git -C gradfolio worktree add ../gradfolio-m4 -b m4/plan origin/main`
  - Never switch a main checkout's branch.
- **API Docker:** its own project and ports. Check the ports with `lsof` first, and
  tear down only `gradfolio-m4`.

  ```sh
  export MYSQL_HOST_PORT=3312 API_HOST_PORT=3006
  docker compose -p gradfolio-m4 up -d mysql
  ```

  The test database is
  `TEST_DATABASE_URL=mysql://gradfolio:gradfolio@127.0.0.1:3312/gradfolio_test`.

- **FE dev server:** `npm run dev -- -p 3010`, never 3000.
- **Work method:**
  - the four phases from CLAUDE.md (investigation, plan, implementation,
    revalidation), then re-review;
  - prove every guard by removal;
  - force races with a barrier, never a sleep.
- **Both reviewers on every push** (`sh scripts/request-review.sh <pr>`):
  - Copilot quota failures are accepted (Codex alone);
  - two rounds, then fix-now only, plus one confirmation round on the head.
- **Migrations deploy to production on merge.** Every new migration must be:
  - additive, and safe while the previous API revision is still serving;
  - applied twice in CI with nothing left the second time;
  - checked with `down` then `up` giving an identical schema.
- **Vercel previews use the production API and database** (a known follow-up).
  - Data you create while testing on a preview is real production data.
  - Use a test account, and delete what you create.
- **Do not:**
  - merge;
  - push to main;
  - edit `gradfolio-api/docs/tracker.md` (propose changes instead).
- **Leave the machine clean:** remove the worktree after the last merge.

## Sub-agent API: brief

**Task:** M4 tasks 4.1–4.5. Decide Q6 in the plan.

1. **Q6, file storage. Levon decides.**
   - **Options, with current prices and links:**
     - Google Cloud Storage in `us-east1` (same project as the API, credits apply);
     - Vercel Blob;
     - Cloudflare R2;
     - URL-only for v1.
   - **For GCS, check by running it, not by recalling it:**
     - V4 signed upload URLs from Cloud Run **without a key file** (IAM `signBlob`
       through the runtime service account; which role it needs);
     - the bucket CORS rule for a browser `PUT`;
     - public read vs signed read for private projects' files.
   - **Q11 says the token never reaches the browser.** The plan must show that an
     upload flow (the browser `PUT`s straight to a signed URL, or the upload goes
     through the Next.js server) keeps that rule.
   - **A bucket is a billed resource:**
     - show the expected monthly cost;
     - get Levon's explicit OK before creating it;
     - gcloud only through the university sandbox (`CLOUDSDK_CONFIG` must be
       `/Users/levon/Dev/university/.sandbox/gcloud`; check it as in `deploy.md`);
     - never create a key file.
2. **4.1 project CRUD.**
   - Owner-only writes: a write that changes 0 rows answers 404.
   - Every read follows Q3 = A: a private project answers 404 to everyone but its
     owner, and is excluded from lists.
   - Validated: metadata, links, tags and technologies through the terms registry,
     and the category enum. Find out how the frontend's 6-value category maps to the
     schema.
   - Projects appear in the profile response that M3 already ships: keep its contract
     stable, or version the change.
3. **4.2 `description_html` sanitized on write.**
   - An allow-list sanitizer. Pick `sanitize-html`, or DOMPurify + jsdom, by
     measuring both against the corpus.
   - The allow-list must match what the FE editor emits (agree it with the FE plan).
   - A corpus of known XSS bypasses as tests: `javascript:` and entity-encoded URLs,
     SVG/MathML, `style`, event handlers, mutation XSS.
   - Stored output is re-sanitized idempotently.
4. **4.3 attachments:**
   - add, update, delete and reorder (atomic, the ids exactly the caller's set);
   - a URL scheme check (https only);
   - type-specific rules (video embeds from an allow-listed host list; PDF).
5. **4.4 lists:**
   - the caller's own projects, in every state;
   - a user's public projects;
   - sort and filter parameters, validated, with stable pagination.
6. **4.5 storage (per Q6):**
   - signed uploads for the avatar, hero images and attachments;
   - size and content-type limits enforced by the signature, not trusted from the
     client;
   - the object deleted when its row is deleted, and a plan for orphans.
   - If Levon picks URL-only, 4.5 moves to stretch.
7. **Every endpoint:**
   - in `openapi.yaml`;
   - has a request in `http/`;
   - has an ownership test and a second-user-gets-404 test;
   - is rate-limited.

**Investigate first:**

- Map every field of the FE project types (`src/data/*.mock.ts`, the project form and
  the project page) to a column, and list the mismatches.
- On MySQL 8.4:
  - an atomic attachment reorder;
  - tag/technology replace-all under a barrier;
  - the cascades when a project is deleted.
- Check whether any migration is needed. If one is, show it is safe against the live
  revision.

**PRs:**

- the plan (`docs/m4-plan.md`), then **stop**: Levon decides Q6;
- (a) the contract plus the reads, so FE can start;
- (b) the writes and the sanitizer;
- (c) attachments and storage;
- then `docs/m4-verification.md`.

**Final test:**

- a fresh clone passes verify, coverage ≥ 90% and integration;
- a second-user matrix: 404 on every write;
- Q3 behaviour for owner, other user and anonymous, on the project and in every list
  and the profile;
- the XSS corpus neutralized on write;
- a grep proving no private project leaks into a public response;
- concurrency under a barrier;
- a real run with a real Auth0 token:
  - create a project with every field and attachment type, edit it, reorder it,
    delete it;
  - check the stored rows and the storage objects;
- on production after deploy: `/readyz` 200, and one create/delete round trip with
  Levon's token;
- OpenAPI check, plan walk, guard proofs, CI green, clean machine.

## Sub-agent FE: brief

**Step 1, start now, independent of the API.**

1. **The Codex comments from gradfolio #53–#56** that landed after merge (tracker
   Follow-ups), as one small PR:
   - the dashboard title during the legacy localStorage-language migration;
   - the `formatDay` UTC test asserting observable output;
   - the stepper focus ring;
   - the connections page title localization;
   - the StepWelcome heading test;
   - the AppNavigation Armenian-label test;
   - the attribution on `fe-m3-verification.md` line 33.
2. **The FE plan** (`docs/m4-plan.md`), then **stop**:
   - the rich-text editor choice (candidates: Tiptap, Lexical; measure bundle size,
     en/ru/am input, accessibility, and the HTML it emits);
   - the form layout per the approved prototype and the UI track's edit model;
   - the edit route;
   - the upload UX per Q6;
   - the field mapping from the API's plan;
   - which Playwright checks run, and whether to add Playwright to the repo (see
     below).

**Step 2, after the lead says the API contract (API PR (a)) has merged and deployed:**

- **4.6 the project form rebuilt:**
  - summary, rich description, category, status, technologies, tags, dates, course,
    professor, visibility;
  - validation that mirrors the API's limits.
- **4.7 the edit page:** `/projects/[id]/edit`, owner-only (the UI is not the guard),
  and delete with a confirmation that names the project.
- **4.8 DOMPurify as the render-time second layer**, replacing the regex sanitizer
  (F1).
- **4.9 `next.config.ts` image hosts** for the storage host (F5); remove the mock
  hosts.
- **4.10 the projects list and detail on the API:**
  - `project.mock.ts` deleted;
  - the attachment form's hardcoded English moved into i18n;
  - loading, empty and error states.
- **Every string in en/ru/am.**
- **All API calls server-side only (Q11)**, through the M2 client and the generated
  types (Q5: bump the pinned API commit).

**PRs:**

- (1) the Codex follow-ups;
- (2) the plan;
- (3) types, the list and the detail;
- (4) the form, the edit page and delete;
- (5) uploads, if Q6 isn't URL-only;
- then the FE M4 verification record.

**Playwright for browser checks.** Use it wherever looking at the real page gives a
better result than reading code: layout, states, keyboard, accessibility, i18n.

- **Setup:**
  - browsers go in the sandbox:
    `export PLAYWRIGHT_BROWSERS_PATH=/Users/levon/Dev/university/.sandbox/ms-playwright`,
    then `npx playwright install chromium` (add webkit only if a check needs it);
  - nothing goes into `~/Library/Caches`.
- **Use it for:**
  - screenshots of every changed page at 390 and 1440, in light/dark and en/ru/am,
    compared with the approved prototype and attached to the PR;
  - a keyboard-only walkthrough of the form and the edit page (tab order, visible
    focus, dialogs trap and return focus);
  - `@axe-core/playwright` on every changed page: 0 serious or critical violations;
  - no console errors or hydration warnings;
  - no layout shift when data loads;
  - XSS payloads pasted into the editor rendering inert.
- **Login:**
  - never script Auth0 credentials;
  - for logged-in pages, Levon logs in once in a headed browser;
  - the saved `storageState` holds session cookies, so treat it as a secret: keep it
    in the scratchpad, outside the repo, and delete it at the end.
- **Scratch scripts by default.**
  - Adding `@playwright/test` to the repo (config, a few smoke specs, a CI job without
    real login) is allowed as **its own PR, proposed in the FE plan first**. It
    counts as groundwork for tracker 9.6.
  - Never stack it with a feature PR.

**Final test:**

- `npm run verify`, coverage and build;
- the Playwright checks above on every changed page, with the results in the
  verification record;
- against the local API (the API sub-agent's `gradfolio-m4` stack on 3006):
  - create a project with every field, reload, and it persists;
  - edit it, delete it;
- a second account cannot edit (the API answers 404, the UI shows not-found);
- a private project follows Q3;
- pasted XSS payloads in the editor render inert;
- light/dark, en/ru/am, at 390 and 1440;
- the production site after merge: one real login → create → view → delete.

## Order of work

1. **Spawn both now.**
   - API writes its plan.
   - FE does step 1 (follow-ups PR, then its plan).
   - Both plans stop for Levon (Q6, the editor, the cost of storage).
2. **After approval, API ships (a).**
   - When it has merged and Deploy is green, tell FE "contract live at `<sha>`, start
     step 2".
3. **Run API (b)/(c) and FE (3)/(4)/(5) in parallel**, obeying the merge order.
4. **Close-out:**
   - every PR merged, with CI green on the head, threads resolved and
     `review-status.sh` OK;
   - both verification docs exist;
   - production `/readyz` 200;
   - no worktrees or containers left.

## Stop points and reporting

- **Stop and report:**
  - when both plans are open (Levon decides Q6, the editor and the storage cost);
  - before creating any billed resource;
  - whenever Levon must act (Auth0, Vercel, GCP).
- **Send reports to the orchestrator session `gradfolio-repos-d8`** with SendMessage,
  in the format from `handoff-template.md` part 2:
  - one report per merged PR, plus a final M4 report;
  - items marked `[api]` or `[fe]`.
- If the orchestrator isn't in ListAgents, append to
  `/Users/levon/Dev/university/gradfolio-repos/m4-report.md`.
- Include **"Proposed tracker changes"**. The orchestrator updates the tracker.
