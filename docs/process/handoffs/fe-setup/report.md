# Frontend setup: worker reports

Written here because the orchestrator session `gradfolio-repos-94` was not listed in
ListAgents (2026-09-30). Worker session: `gradfolio-repos-02`.

---

## Report 1: plan (stop point)

## Task

Tracker 0.7 (frontend baseline), 0.8 (frontend CI), porting the working model, F6 docs.
This report covers the plan PR.

## Status plan ready for approval → merged by Levon 2026-09-30 12:28Z (`8d1499e`)

## Pull requests gradfolio#6 Setup plan — https://github.com/Levon0Asatryan/gradfolio/pull/6

                     — Vercel check green (no CI exists yet) — 0 threads

## Investigation (details and output in docs/setup-plan.md)

- Baseline `ffe1eeb` on Node 24.20: `npm ci`, `build`, `eslint` and `tsc` PASS.
  `knip` FAIL (66/67 findings are config noise; 6 real). `prettier --check .` FAIL
  (4 non-src files).
- `next build` needs no Auth0 variables: it ran with none set. Only `middleware.ts`
  imports `lib/auth0`, and the v4.14 constructor only `console.error`s missing options.
  CI builds without placeholders.
- Real run with no env: F2 reproduced (`/auth/login` → 404 after `TypeError: Invalid URL`
  is swallowed).
- Production's authorize URL has no `audience`, so `AUTH0_AUDIENCE` is unset on Vercel (2.8).
- Node 24: every engine range allows it. `@types/node` must go `^20` → `^24`, because
  Vitest 5 fails `ERESOLVE` against 20.
- Vitest spike: Vitest 5 + jsdom 30 + RTL 16; no `@vitejs/plugin-react` needed (oxc
  honours `jsx: react-jsx`); Vite 8 `resolve.tsconfigPaths` handles `@/`.
- The review scripts work unchanged here: the slug is detected via `gh repo view`.
- Codex app is installed: it reviewed #5 in 2025-12, and reacted 👀 to #6's request.
  Copilot: quota failure on `acc4676`, as expected.

## Defects found (not fixed; see Open questions)

- **Security:** `next@16.1.4` is behind 33 advisories, including 2 critical and several
  middleware/proxy bypasses. All are fixed in 16.3.3+ (latest 16.3.7, within `^16.1.4`).
  `@auth0/nextjs-auth0` 4.14.0 has a moderate advisory (latest 4.30.0).
- **Proposed F7:** `HighlightedText` has a broken regex escape. Typing `C++`, `(` or `[`
  into search on `/search` or `/projects` throws during render. Reproduced in Node and in
  a component test.

## Re-review Plan PR: one round requested (Copilot + Codex on `acc4676`).

                     At merge, Codex was still 👀 and Copilot had failed on quota.

## Not verified Vercel project settings (Node version, build override).

## Changes needed in other repos

- gradfolio-api tracker (proposals, below). No other change.

## Proposed tracker changes

- 0.7 → done (docs/setup-plan.md, gradfolio#6).
- 0.8 → review once PR (a) opens.
- 2.15 → covered by setup PRs (b)/(c).
- New F7 row: `HighlightedText` regex escape.
- New row: frontend security bump (next 16.3.7, auth0 4.30.0).
- 2.8 note: production authorize URL has no `audience` (checked 2026-09-30).

## Open questions for Levon

1. Security bump as its own PR before (a)? (recommended: yes)
2. Fix F7 in (a), with the component test as its regression test? (recommended: yes)
3. Keep the receipt gate for teammates, with `SKIP_REVIEW_GATE=1` documented? (recommended: yes)
4. Vercel project Node version / build-command override.
5. Close stale PR #5?
6. Settings: auto-delete head branches (off), the "Clean Code Rules" ruleset (disabled),
   Dependabot security updates, the Copilot quota, `AUTH0_AUDIENCE` on Vercel.

---

## Report 2: PR #7 (security bump)

## Task

§6 Q1 (Levon: own PR, first): bump `next` and `@auth0/nextjs-auth0` for their advisories.

## Status done (awaiting merge)

## Pull requests gradfolio#7 deps: next 16.3.7 and nextjs-auth0 4.30.0 — https://github.com/Levon0Asatryan/gradfolio/pull/7

                     — Vercel green (CI arrives with #8) — 0 threads

## What changed next 16.1.4 → 16.3.7, @auth0/nextjs-auth0 4.14.0 → 4.30.0, eslint

                     plugin/config to match, `npm audit fix` (in range). `npm audit`: 17 → 0.

## Revalidation build, eslint, tsc pass. Real run with `next start`:

                     - no env: 5 pages 200, `/auth/login` 404 as on main (F2);
                     - with tenant env and a dummy client: `/auth/login` 307 to `…auth0.com/authorize`.

## Re-review Codex: no findings on `704033c`. Copilot: quota failure.

## Not verified A real login round-trip (needs production credentials).

---

## Report 3: PR #8 (toolchain, tracker 0.8)

## Task

Plan §3.1–3.2: Node 24, scripts, Vitest with the first tests, hooks, review scripts, CI. F7 fix (§6 Q2).

## Status done (awaiting merge; stacked on #7)

## Pull requests gradfolio#8 Toolchain: Node 24, Vitest, hooks, review scripts, CI (0.8)

                     — https://github.com/Levon0Asatryan/gradfolio/pull/8
                     — CI 3/3 green + Vercel on `1d6ffa1` — threads 4: 3 fixed and resolved, 1 deferred (open)

## What changed

- Node 24 everywhere; API-named scripts (`verify`, `typecheck`, `lint`, `format:check`, `test*`).
- Vitest 5 + jsdom + Testing Library: 65 tests, coverage ratchet at the achieved value.
- lint-staged pre-commit (replaces the whole-`src/` reformat); pre-push runs check-branch, require-review and verify.
- The four review scripts, plus regression tests for all of them.
- CI with 3 jobs; knip's real findings removed (1 file, 4 dependencies, 1 type).
- F7 fixed (`HighlightedText` regex escape).

## Re-review

- Round 1 (Codex, `fcf51be`), 2 findings, both fixed in `46b3611`: the push gates judged the
  checkout, not the pushed refs (`HEAD:main` and other-branch bypasses).
- Round 2 (Codex, `46b3611`), 1 finding, fixed in `1d6ffa1`: annotated tags were refused.
  Same push: `406db9c`, a race in request-review (my own finding: it named the previous head).
- Confirmation round (Codex, `1d6ffa1`), 1 P2, deferred as not fix-now (it fails closed):
  request-review should wait for the pushed OID, not a branch-name match.
- Copilot: quota failure on every head.

## Defects found

- F7 (new): reproduced in the browser on main. Typing `+abstractive` on /search kills the page.
- **The push-gate scripts and request-review in gradfolio-api have the same three defects**
  (HEAD:main bypass, other-branch bypass, head race), and the tag issue would follow a stdin fix.
- **Incident (mine, repaired):** the first real pre-push run of my new push-gates test inherited
  `GIT_DIR`/`GIT_INDEX_FILE` from the hook and wrote to the real gradfolio repository:
  `core.bare=true`, `core.hooksPath=/dev/null`, local `setup/toolchain` moved to a test commit,
  stray branches, local `origin/main` rewritten. Nothing reached GitHub, and the main checkout's
  working tree was untouched. All restored by hand within minutes; the main checkout was
  unusable ("must be run in a work tree") until then. The test now strips `GIT_*` and refuses
  to run if any remain; it was proved in a disposable clone.

## Evidence docs/setup-verification.md (in #11) §2–§5.

## Changes needed in other repos

- gradfolio-api: port the push-gate fixes: `check-branch.sh`/`require-review.sh` read pre-push
  stdin, branch refs only; `request-review.sh` waits for the pushed head; plus `push-gates.test.ts`
  with its GIT_* guard. A follow-up row, not done here (no writes to gradfolio-api).

---

## Report 4: PR #10 (working model, F6)

## Task

Plan §3.3: CLAUDE.md, AGENTS.md, Copilot instructions, `.review/`, the gradfolio-web-review skill and workflow, docs; F6.

## Status done (awaiting merge; stacked on #8)

## Pull requests gradfolio#10 Working model: CLAUDE.md, AGENTS.md, review skill and corpus, docs (F6)

                     — https://github.com/Levon0Asatryan/gradfolio/pull/10
                     — CI 3/3 + Vercel green on `e5dc693` — threads 8/8 fixed and resolved

## What changed

- CLAUDE.md: the API's "How work is done", the API tracker as plan of record, a Commands table,
  and F6 corrections (no backend, 10 tables, vercel.json, v3 env names, "middleware protects all routes").
- AGENTS.md: the API bar plus the sanitizer (the regex one does not count, per Codex on #6, verified
  by running it), tokens, server-only API, hidden-UI-not-a-guard, fail-closed middleware, URLs and
  redirects, shared caches, i18n, accessibility.
- `.review/` (stack `gradfolio-web`) with 2 rules mined from #8; the skill; the workflow with frontend
  lenses plus a plan lens. README updated (F6).

## Re-review

- Round 1 (Codex, `414ff38`), 2 findings, fixed: the skill's receipt template hardcoded 0, and the
  workflow skipped pass 0.
- Round 2 (Codex, `7c7bf43`), 4 findings, fixed in `8fced7a`: regex matches counted as failures,
  a partial pass 0 read as clean, PR deferrals ignored, no tests. The open count is now computed in
  JS; `review-workflow.test.ts` runs the real workflow file with fake agents.
- Confirmation (Codex, `8fced7a`), 2 P1s, both fail-open in the gate, fixed as fix-now in `e5dc693`:
  an incomplete ranking, and an invented deferral (my own test had codified it).
- Confirmation on `e5dc693`: Codex, no findings. Copilot: quota failure on every head.

## Evidence review-workflow.test.ts: 12 cases. 7 single-rule removals each fail their case;

                     the old versions fail 10/10 (`7c7bf43`) and 2/12 (`8fced7a`).

## Not verified The skill loaded as a skill, and the workflow executed for real (no workflow

                     runtime in this session); only lint, parse and the harness.

## Changes needed in other repos

- gradfolio-api: its skill and workflow have the same receipt defects (hardcoded 0 in the template;
  no pass 0 in the workflow; agent-computed count). Port the counted-in-code workflow and its test.

---

## Report 5: PR #11 (hygiene, verification) and the setup as a whole

## Task

Plan §3.4 and the Phase 3 final test record (`docs/setup-verification.md`).

## Status done; all four setup PRs are ready to merge in order #7 → #8 → #10 → #11

## Pull requests

- #7 `704033c` base main MERGEABLE Vercel green threads 0/0 Codex clean
- #8 `1d6ffa1` base setup/security MERGEABLE CI 3/3 + Vercel green threads 3/4 (1 deferred)
- #10 `e5dc693` base setup/toolchain MERGEABLE CI 3/3 + Vercel green threads 8/8
- #11 `85d62fe` base setup/model MERGEABLE CI 3/3 + Vercel green threads 1/1 Codex clean
- Copilot: "FAILED … quota limit" on every head, as expected. Codex reviewed every head.
- #11 carries two merges of setup/model (force-push is denied here), so its own diff stays its own.

## What changed (#11)

- Editor and community files: .editorconfig, .gitattributes, .vscode, LICENSE (MIT, Levon Asatryan),
  CODE_OF_CONDUCT, CONTRIBUTING (documents SKIP_REVIEW_GATE=1, plus jq/gh), SECURITY (frontend scope).
- PR and issue templates, dependabot.yml, .env.example (Auth0 v4 names, API_BASE_URL).
- docs/setup-verification.md.

## Revalidation (docs/setup-verification.md)

- Fresh clone of the final code `c375a75`: npm ci (0 vulnerabilities), verify, test:coverage (77 tests),
  build, and every Commands-table command; `npm start` and `npm run dev` serve the four pages.
- Hooks: pre-commit refuses lint, test and type errors. Pre-push refuses main, `HEAD:main`, detached
  HEAD, no receipt, a stale receipt, open findings, and another branch's commit; it passes docs-only
  pushes and `--follow-tags`.
- CI red paths on throwaway #9: a lint error turned `static` red (run 36732733553); a failing test
  turned `test` red (run 36734311176). #9 is closed and its branch deleted.
- The app renders as before: headless Chrome reads identical text on 7 pages, main vs final.
  F7 reproduced in the browser on main (the page dies) and is fixed.
- Vercel previews built for #7, #8, #10 and #11; #8 proves Vercel accepts `engines` Node 24.

## Re-review (#11)

- Round 1 `44455cc`: no findings. `33bf4c4` (merge plus record): no findings.
- `c375a75`, 1 P2, fixed in `85d62fe`: the record's fresh-clone gate had run on older code; re-ran it on c375a75.
- Confirmation on `85d62fe`: no findings.

## Machine

No dev servers, Chrome or test processes left; scratch clones removed. The worktree
`gradfolio-setup` stays until the last merge (it holds the stacked branches); remove it afterwards with
`git -C gradfolio worktree remove ../gradfolio-setup`. Shared git config verified intact
(`core.bare=false`, `core.hooksPath=.husky/_`).

## Not verified

- `/gradfolio-web-review` as a loaded skill, and its workflow run for real (harness only).
- A real Auth0 login round-trip. Copilot on any head (quota).

## Proposed tracker changes

- 0.7 → done (setup-plan.md, #6). 0.8 → done once #8 merges (CI, PR template in #11).
- 2.15 → done by #10/#11 (Auth0 v4 names in CLAUDE.md/README; .env.example). F6 → closed.
- New F7 (`HighlightedText` regex escape crash) → fixed in #8.
- New row: frontend security bump → done (#7).
- 2.8 note: the production authorize URL carries no `audience` (checked 2026-09-30).
- New follow-ups: (a) request-review waits for the pushed OID, not a branch-name match (#8 deferral;
  gradfolio and gradfolio-api); (b) **gradfolio-api: port the push-gate fixes** (stdin refs, branch-only
  comparison, request-review race) **and the review-workflow receipt fixes**, with their tests;
  (c) the middleware→proxy rename (Next 16 warning; with 2.11); (d) formatDate uses the browser
  locale, not the UI language (M3); (e) the `API_BASE_URL` local port clash: the API and `next dev`
  both default to 3000 (M2, 2.9).

## Open questions for Levon

1. Merge order #7 → #8 → #10 → #11. With squash merges, retarget each next PR to `main` and rebase it
   (GitHub retargets automatically only if auto-delete of head branches is on, and it is **off**).
2. Turn on **private vulnerability reporting** (off on gradfolio and gradfolio-api; SECURITY.md relies on it).
3. Turn on Dependabot security updates (disabled), auto-delete head branches (off), and branch
   protection or the disabled "Clean Code Rules" ruleset.
4. Copilot quota: still blocks `review-status.sh` exiting 0 on every PR.
5. Vercel: set `AUTH0_AUDIENCE` (2.8); confirm the project has no Node or build-command override
   (the previews built with `engines` Node 24).
6. Close the stale PR #5 (2025-12; it conflicts with the hook and ESLint changes).
7. Teammates (Parg3e3v, narekpoghosyan05): after #8, `npm ci` installs the new hooks; without Claude Code
   they push with `SKIP_REVIEW_GATE=1` (CONTRIBUTING).

---

## Report 6: after the merges — #10 and #11 did not reach main; recovery PR #12

- #8, #10 and #11 were merged into their stacked bases (09:44:27–09:44:55Z) before #7 went to main
  (09:45:20Z). #7's squash carried `setup/security`, which by then included #8. So `main` (`abd8ec0`)
  has exactly #8's tree; #10's and #11's content stayed in `setup/toolchain`/`setup/model`.
  Main's CI and the production Vercel deploy are green.
- gradfolio#12 replays the same 18 commits onto main (`git rebase --onto origin/main 1d6ffa1`);
  its tree is byte-identical to `85d62fe`, the reviewed head. CI 3/3 and Vercel green, MERGEABLE;
  both reviewers requested on `f5f270c`.
- **Levon:** merge #12 into main. Then the `setup/*` remote branches can be deleted, and the worktree
  removed (`git -C gradfolio worktree remove ../gradfolio-setup`).
- Lesson for future stacked PRs: merge bottom-up, retargeting each next PR to `main` before merging
  it, or don't stack.

---

## Report 7: landed and cleaned up (2026-10-02)

- #12 merged (`f2318c9`); `main`'s tree is byte-identical to the reviewed final head `85d62fe`.
  CI on main: success. Vercel production: deployed.
- Deleted the remote branches setup/baseline, security, toolchain, model, hygiene and land, plus the
  local ones; removed the `gradfolio-setup` worktree. Shared git config intact (`core.bare=false`,
  `core.hooksPath=.husky/_`).
- Not touched: the main checkout `gradfolio/` is still at `ffe1eeb` (behind origin/main). Run
  `git -C gradfolio pull && (cd gradfolio && npm ci)` to get the new hooks and toolchain.
- Still open: the follow-ups and Levon's settings listed in Report 5 (the gradfolio-api port of the
  gate and workflow fixes; private vulnerability reporting; Dependabot security updates; auto-delete
  of branches; the Copilot quota; `AUTH0_AUDIENCE` on Vercel; stale PR #5).

---

## Report 8: review-gate fixes ported to gradfolio-api; Dependabot PRs resolved (2026-10-03)

### Port to gradfolio-api (per Levon's instruction to finish it despite the original handoff's exclusion)

- gradfolio-api#18 (merged): ported the push-gate fixes from gradfolio — check-branch.sh/require-review.sh
  read the pre-push hook's stdin and judge the pushed refs, not the checkout; request-review.sh waits
  for git ls-remote instead of a branch-name match; the gradfolio-review skill/workflow receipt is
  counted in code so it can't say clean by omission. New push-gates.test.ts (16 tests) and
  review-workflow.test.ts (12 tests) run the real scripts/workflow file; all fail against the
  pre-fix versions. Full gate: verify (314→446 unit tests as M2 landed meanwhile), test:int (69,
  real MySQL 8.4 via an isolated docker-compose project), build, openapi:check — all green.
- Codex found one more real bug on #18 _after_ Levon merged it: `.husky/pre-push` itself still gave
  only the first gate a copy of stdin, so the second gate always saw EOF and fell back to judging
  the checkout — silently defeating the script fix. Filed as gradfolio-api#19 (merged): the hook now
  reads stdin once and pipes a fresh copy to each gate, with a test that runs the real hook file
  end to end and fails against the hook that merged in #18. One Codex round (test-assertion
  strengthening), confirmed clean on the fix.
- `main` on both repos now matches the final reviewed commit byte-for-byte (checked by diff).

### gradfolio Dependabot PRs (per Levon's instruction)

| PR  | What                                                                                                                  | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #13 | production group (fontsource, react, react-dom, rooks; minor/patch)                                                   | **merged** — CI green                                                                                                                                                                                                                                                                                                                                                                                                                |
| #14 | development group (eslint-plugin-react-hooks, eslint-plugin-unused-imports, prettier, typescript-eslint; minor/patch) | **merged** — CI green                                                                                                                                                                                                                                                                                                                                                                                                                |
| #17 | @vercel/speed-insights 1.3.1 → 2.0.0 (major)                                                                          | **merged** — CI green, changelog is license/Nuxt-only                                                                                                                                                                                                                                                                                                                                                                                |
| #15 | react-resizable-panels 3.0.6 → 4.14.1 (major)                                                                         | **closed** — confirmed by running typecheck: v4 removes/renames `PanelGroup`, `PanelResizeHandle`, both imperative handle types, changes the resize callback signature, and drops `Panel`'s `order` prop. `SideBarWrapper.tsx` needs a real rewrite against the new API plus manual verification (resize/collapse/persistence), not a version bump. Told Dependabot to stop reopening it; proposing a tracker row for the migration. |
| #16 | typescript 5.9.3 → 7.0.2 (major)                                                                                      | **closed** — confirmed by running `npm ci`: it fails outright, `knip@5.88.1` requires `typescript <7`. Checked further: even `typescript-eslint@8.71.0` (latest published, not just what's pinned) still requires `typescript <6.1.0`. TS7 needs the whole toolchain to catch up first. Told Dependabot to stop reopening it.                                                                                                        |

`main` (gradfolio) verified green after all three merges: `npm run verify` (79 tests) and `npm run build` both pass.

### Cleanup

Removed both `*-kit` worktrees and their local/remote branches. No stray Docker containers or test
processes left running. Did not touch either main checkout (`gradfolio/` has an unrelated `next dev`
process and local `AGENTS.md` edit running/present from elsewhere — left alone).

### Proposed tracker follow-ups

- gradfolio: migrate `SideBarWrapper` to `react-resizable-panels` v4 (new Panel/PanelGroup/
  PanelResizeHandle API), then un-ignore the Dependabot major.
- gradfolio: revisit the TypeScript 7 upgrade once `typescript-eslint` supports it.
