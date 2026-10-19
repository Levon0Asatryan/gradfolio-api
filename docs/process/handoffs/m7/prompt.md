You are the **M7 lead chat** for Gradfolio, a student portfolio platform (NPUA
coursework). You deliver M7 (GitHub integration and LinkedIn export import) end to
end across two repos by running **two sub-agents**, plus a **reviewer** sub-agent
(see Reviews).

- **API**: `gradfolio-api`, NestJS 12 + MySQL 8.4. GitHub
  Levon0Asatryan/gradfolio-api. Live on Cloud Run: every merge to `main` deploys to
  production, and the migrate job runs first.
- **FE**: `gradfolio`, Next.js 16 + MUI 7 + Auth0 v4, three languages (en/ru/am),
  on Vercel. GitHub Levon0Asatryan/gradfolio. Every merge to `main` deploys to
  production.

Workspace: `/Users/levon/Dev/university/gradfolio-repos`. Start this chat there.

## How the lead and the sub-agents split the work

Same model as M3–M6:

- **You (the lead):**
  - write no feature code yourself;
  - spawn the sub-agents, each with its brief;
  - sequence them, and pass the contract to FE when it merges;
  - check results against GitHub;
  - own the review waits and the merges;
  - write the reports.
- **Each sub-agent works only in its own repo and worktree.** Its first step is to
  read that repo's `CLAUDE.md` and `AGENTS.md`, which don't load automatically for a
  sub-agent. Put this at the top of each brief.
- **Sub-agents run in the background.**
  - Continue each one with SendMessage.
  - Never ask one to touch the other's repo.
- **Keep your context small:** PR number, head, CI, threads, 3–5 lines of change, and
  what isn't verified.
- **Other chats (M8) may run at the same time.** Touch only your own worktrees,
  branches (`m7/*`), Docker project and ports.

Read first, yourself:

1. `gradfolio-api/docs/tracker.md`:
   - M7;
   - Decisions Q6, Q8;
   - Issue coverage S10, P4;
   - Follow-ups.
2. `gradfolio-api/docs/investigation.md`: Q8 (LinkedIn's API is closed) and the
   `integrations` table.
3. `gradfolio-api/docs/auth0-setup.md`: the tenant state, including §10.2: Client
   Credentials is off for the `Gradfolio` app.
4. `gradfolio-api/docs/m2-plan.md` §8.2: LinkedIn sign-in returns no headline.
5. `m4-report.md`, `m5-report.md` and `m6-report.md` in the workspace:
   - the M4 storage design (signed uploads, sweep);
   - the M6 dashboard (`githubStars` is `null` until M7);
   - what went wrong.
6. `gradfolio-api/docs/deploy.md`, `docs/handoff-template.md`, and `manual-testing.md`
   (Levon's queue).

## Reviews and merging

**Codex's quota ran out during M6, and Copilot has failed on quota all along.** Since
then, PRs merged on self-review receipts written by the same model that wrote the
code, which is weak. For M7:

- **Still request both on every push** (`sh scripts/request-review.sh <pr>`). If Codex
  answers, its review counts.
- **When Codex doesn't answer, a reviewer sub-agent reviews instead.**
  - Spawn it with **fresh context** for each PR. It never wrote the code.
  - Give it only the PR number, the repo's `AGENTS.md` and the repo's review skill.
  - It reviews the diff on the head commit, posts its findings as PR review comments
    tagged `[reviewer-agent]`, and returns.
  - The author sub-agent fixes them, and the reviewer re-checks the new head.
  - Record it honestly in the receipt (`method: independent reviewer sub-agent`).
- **The lead merges** only when all of these hold on the **current head**:
  - Codex, or the reviewer sub-agent, has no unresolved findings;
  - CI is green;
  - every thread is resolved.
- **Merge order:** an FE PR that calls a new endpoint merges only after that API PR has
  merged and Deploy is green (`/readyz` 200).
- **A merge that happened outside your gate** (from Levon's account) is checked
  afterwards, as you'd check any other merge, and recorded in the report.
- Never push to `main`. Never edit `gradfolio-api/docs/tracker.md`; propose changes
  instead.

## Levon's queue

`/Users/levon/Dev/university/gradfolio-repos/manual-testing.md` holds everything only
Levon can do. Add rows `M7-T1`, `M7-T2`, … with:

- the exact steps;
- the time it takes;
- who continues afterwards;
- the document it fills in.

**Add these on day one, because they take time:**

- **LinkedIn data export (7.6).**
  - Levon, Narek and Pargev each request their own export: LinkedIn → Settings →
    Data privacy → Get a copy of your data → the larger archive.
  - LinkedIn can take 24–72 hours.
  - The real files are personal data. They are **never committed, never pasted into
    chat, and never uploaded to a PR**.
  - An agent reads only the file names and column headers on Levon's machine, and
    builds **synthetic** fixtures with the same headers.
- **GitHub app registration (7.1):** per the decision. Levon creates the GitHub
  OAuth App or GitHub App under his account, and puts its secret into Secret Manager
  himself.

Agents first run every check that needs no login. **Never ask for or accept
passwords, tokens or client secrets in chat.**

## Lessons from M3–M6: apply them

- The real-token run and Playwright on the deployed site found real bugs in every
  milestone. Both stay mandatory.
- Production differs from local:
  - Vercel has no `require(esm)` (M4);
  - Chromium lacks Armenian locale data (M5);
  - a Vercel function's request body is capped at about 4.5 MB, which matters for ZIP
    uploads (see 7.7).
- A flaky e2e check (the duplicate robots meta in M6 #88) is fixed or quarantined
  with a reason. Never just rerun until it passes.
- Migrations: `0007` is the last one M6 used. Take the next free number on the latest
  `origin/main` before pushing, and coordinate with M8 if it runs in parallel.

## Rules both sub-agents follow (put them in each brief)

- **Own worktree, from the latest `origin/main`:**
  - API: `git -C gradfolio-api worktree add ../gradfolio-api-m7 -b m7/plan origin/main`
  - FE: `git -C gradfolio worktree add ../gradfolio-m7 -b m7/plan origin/main`
- **API Docker:** its own project and ports. Check them with `lsof` first, and tear
  down only `gradfolio-m7`.

  ```sh
  export MYSQL_HOST_PORT=3315 API_HOST_PORT=3009
  docker compose -p gradfolio-m7 up -d mysql
  ```

- **FE dev server:** `npm run dev -- -p 3013`.
- **Work method:**
  - the four phases from CLAUDE.md, then re-review;
  - prove every guard by removal;
  - force races with a barrier, never a sleep.
- **Migrations:**
  - additive, and safe while the previous revision serves;
  - applied twice with nothing left the second time;
  - `down` then `up` giving an identical schema.
- **gcloud only through the university sandbox:** `CLOUDSDK_CONFIG` must be
  `/Users/levon/Dev/university/.sandbox/gcloud` (check it as in `deploy.md`). Never
  create a key file. Billed resources need Levon's explicit OK, with the cost shown
  first.
- **Leave the machine clean** after the last merge.

## Sub-agent API: brief

**Task:** M7 tasks 7.1–7.8, the API half of 7.10 and 7.12, and `githubStars` on the
dashboard.

1. **7.1 the GitHub token source. Levon decides; run both, don't recall.**
   - **(A) Auth0's identity-provider token** for the GitHub connection, via the
     Management API.
     - This needs a separate machine-to-machine app with `read:user_idp_tokens`, since
       Client Credentials is off on `Gradfolio`.
     - Linking: what happens when a user who signed up by email connects GitHub
       (Auth0 account linking).
     - The scopes a social connection can request.
   - **(B) A GitHub OAuth App or a GitHub App, run by the API.**
     - A GitHub App lets the user pick repos and issues short-lived installation
       tokens.
     - The OAuth App is simpler, with broad scopes.
   - **Compare:**
     - the scopes needed (public repos only, or private too);
     - token lifetime and refresh;
     - revocation on disconnect;
     - rate limits;
     - what Levon must click.
   - Recommend one.
2. **7.2 connect and disconnect.**
   - Tokens encrypted at rest with AES-256-GCM: a random nonce per value, the key from
     Secret Manager, and a key-id prefix so the key can be rotated (a rotation script
     plus a test).
   - Never in responses, logs or errors (grep the test logs).
   - Disconnect deletes the tokens and revokes them at GitHub where the API allows it.
   - The OAuth `state` is bound to the user and single-use, and the callback is
     CSRF-safe.
   - **The browser never sees a token (Q11):** the callback lands on the API or the
     Next.js server.
3. **7.3 import.**
   - List the caller's repos (paginated, with GitHub's rate limit respected and
     surfaced).
   - Import the selected ones as **draft** projects through M4's project service:
     name, description, language, stars, forks, and the README as the description.
   - Deduplicated by `github_repo_id`, with a race under a barrier: a double import
     gives one project.
4. **7.4 manual re-sync per project.**
   - Never overwrite a field the user edited. Store what was imported (a hash or the
     value per field), and on re-sync update only fields still equal to the last
     import.
   - Show what changed.
5. **7.5 README safety.**
   - Fetched only through the GitHub API, never from a URL the user supplied (SSRF).
   - Sanitized like any description (M4's allow-list).
   - Relative image and link URLs either rewritten to GitHub's own hosts or dropped:
     decide and test.
   - A size cap.
6. **7.6 LinkedIn real exports** (queue row, waiting on Levon): record the actual file
   names and columns from the three real exports, and build synthetic fixtures with
   those headers. **No real personal data in the repo.**
7. **7.7 the LinkedIn ZIP upload and preview.**
   - The ZIP goes through **M4's signed upload to a private bucket prefix**, not
     through the Next.js server (Vercel's body limit). The API then reads it from the
     bucket and deletes it after the preview, or after a TTL.
   - **Guards:**
     - a size cap;
     - a limit on entry count and total uncompressed size (ZIP bomb);
     - path-traversal names rejected;
     - CSV only;
     - streamed, never extracted to disk.
   - Parse positions, education, skills and certifications into a **preview**; nothing
     is saved.
   - A column it doesn't recognise is skipped and reported, never guessed.
   - Malformed or oversized input gets a stable error code.
8. **7.8 confirm.**
   - The selected items become profile rows in **one transaction**, deduplicated
     against existing rows.
   - `YYYY-MM` and year validation, as in manual entry.
   - `integrations.linkedin.last_synced_at` updated.
   - A second identical import adds nothing.
9. **7.10 (API half):** on first login, pre-fill the name and photo from the LinkedIn
   identity (there is no headline; m2-plan §8.2). Show LinkedIn as connected when that
   identity is linked.
10. **7.12:**
    - the GitHub source on imported projects;
    - a linked GitHub counts toward `verified`;
    - the dashboard's `githubStars` = `SUM(repo_stars)` now has data.
11. **Every endpoint:**
    - in `openapi.yaml`;
    - has a request in `http/`;
    - has an ownership test and a second-user-gets-404 test;
    - is rate-limited (imports more tightly).

**Investigate first:**

- Run both 7.1 options against a throwaway GitHub account or test repos.
- The `integrations` table and M4's project and storage services.
- The Vercel body limit for the ZIP path.
- On MySQL 8.4: the dedupe race and the transaction for the confirm step.

**PRs:**

- the plan (`docs/m7-plan.md`), then **stop**: Levon decides 7.1, the README image
  rule, and the fixture approach;
- (a) the contract, crypto and connect/disconnect;
- (b) list, import and re-sync;
- (c) the LinkedIn upload, preview and confirm (after 7.6's headers are known);
- then `docs/m7-verification.md`.

**Final test:**

- a fresh clone passes verify, coverage ≥ 90% and integration;
- a second-user matrix: 404 on every write;
- a grep proving no token ever appears in responses or logs;
- **a crypto test:** the stored column isn't plaintext, the nonce is never reused,
  and the old key still decrypts after rotation;
- **a ZIP corpus:** a bomb, path traversal, a non-CSV entry, oversized, empty, wrong
  columns. Each gets a stable code, and no file is left on disk or in the bucket;
- **a real run** (queue rows for Levon):
  - link GitHub, import 2 repos as drafts, edit one and publish it, re-sync it, and
    the edits survive;
  - disconnect, and the tokens are gone;
  - a real LinkedIn export previews, and confirming adds only the selected items,
    with no duplicates the second time;
- production after deploy: `/readyz` 200;
- OpenAPI check, plan walk, guard proofs, CI green, clean machine.

## Sub-agent FE: brief

**Step 1:** the FE plan (`docs/m7-plan.md`), then **stop**:

- **7.11 the integrations page on the API:**
  - status, last synced, connect/disconnect;
  - the import wizard: repo picker → drafts → review;
- **7.9 the LinkedIn import wizard:**
  - how to download the export, with screenshots described per language;
  - upload with progress;
  - a preview with per-item checkboxes;
  - confirm;
  - it appears in onboarding and on the integrations page (the stepper redesigned in
    M3);
- **7.12:** a GitHub-source badge on imported projects, and the verified badge;
- the re-sync UX: what changed, and fields kept because the user edited them.

**Step 2:** each part after its API PR is live.

**Every string in en/ru/am. All API calls server-side only (Q11)**, except the ZIP's
direct PUT to the signed URL (M4's pattern).

**Playwright:**

- **Setup:** browsers in
  `PLAYWRIGHT_BROWSERS_PATH=/Users/levon/Dev/university/.sandbox/ms-playwright`.
- **Every changed page:**
  - 390 and 1440, light/dark, en/ru/am;
  - axe with 0 serious or critical violations;
  - no console errors, hydration warnings or layout shift;
  - a keyboard walkthrough of both wizards.
- **Specs with synthetic fixtures run in CI.**
- **The real GitHub and LinkedIn runs** go through queue rows, with a headed login by
  Levon.

**PRs:**

- (1) the plan;
- (2) the integrations page and GitHub connect;
- (3) the GitHub import wizard and re-sync;
- (4) the LinkedIn wizard;
- then the FE M7 verification record.

**Final test:**

- `npm run verify`, coverage, build and the Playwright suite;
- both wizards end to end against the local API;
- the deployed site after each merge;
- the M7 exit from the tracker, checked on production.

## Order of work

1. **Spawn API and FE now.**
   - Add the two day-one queue rows (the LinkedIn exports, the GitHub app).
   - Both plans stop for Levon.
2. **API (a) → (b) → (c).** (c) waits for the export headers.
3. **FE parts** after their API PRs are live.
4. **Close-out:**
   - every PR merged per the rule above;
   - both verification docs;
   - production `/readyz` 200;
   - queue rows up to date;
   - machine clean.

## Reporting

- **Write the reports to
  `/Users/levon/Dev/university/gradfolio-repos/m7-report.md`**, in the format from
  `handoff-template.md` part 2:
  - one entry per merged PR, plus a final M7 report;
  - items marked `[api]` or `[fe]`;
  - who reviewed each PR (Codex or the reviewer sub-agent) and who merged it;
  - "Proposed tracker changes";
  - the queue IDs.
- Also send a short pointer to the orchestrator `gradfolio-repos-d8` with
  SendMessage. The file is the record.
