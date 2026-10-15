You are a worker chat setting up the **gradfolio** frontend repository to work the
way gradfolio-api already does.

Gradfolio is a student portfolio platform (NPUA coursework). It has three
repositories:

- `gradfolio`: this repo, the Next.js 16 frontend (MUI 7, Auth0 v4, three languages:
  en/ru/am, deployed on Vercel);
- `gradfolio-api`: the NestJS backend and the **plan of record**;
- `gradfolio-sql`: schema reference only.

Workspace: `/Users/levon/Dev/university/gradfolio-repos`.
Frontend: `/Users/levon/Dev/university/gradfolio-repos/gradfolio` (GitHub
Levon0Asatryan/gradfolio).

After you finish, every frontend feature is built by a chat started **inside**
`gradfolio/`, following that repo's own `CLAUDE.md` and `AGENTS.md`. Your job is to
make that possible and safe. You are not building features.

## Work in your own worktrees

Other workers are active in `gradfolio-api` (M1 in the main checkout, M2 in
`gradfolio-api-m2`). Read `gradfolio-api` freely, **never write in it**. For the
frontend, do not work in the main checkout either:

```sh
git -C /Users/levon/Dev/university/gradfolio-repos/gradfolio fetch origin
git -C /Users/levon/Dev/university/gradfolio-repos/gradfolio worktree add \
  /Users/levon/Dev/university/gradfolio-repos/gradfolio-setup -b setup/baseline origin/main
```

Check that `git config user.email` is `levonasatryan1098@gmail.com`.

Read these first, in order:

1. `gradfolio-api/CLAUDE.md`: how work is done. This is the model you are porting.
2. `gradfolio-api/AGENTS.md`: the review contract.
3. `gradfolio-api/docs/tracker.md`: tasks 0.7 and 0.8, M2's frontend tasks 2.8–2.15,
   and issues F1–F6.
4. `gradfolio-api/docs/investigation.md` §4: the analysis of the frontend.
5. `/Users/levon/Dev/university/gradfolio-repos/issues.md`: F1–F6.
6. `gradfolio/CLAUDE.md` and `gradfolio/README.md`: the frontend's current
   conventions, some of them out of date.

Reference implementation for every file below: gradfolio-api's merged setup PRs
#1–#6 and #10/#13. Adapt the rules to a Next.js app; don't copy NestJS specifics.

## Task

Tracker tasks **0.7** (frontend baseline) and **0.8** (frontend CI), plus porting the
working model: conventions, review contract, push gates, review scripts and
templates. Also fix the documentation drift in F6.

## Scope

In:

1. **Baseline (0.7).** On `origin/main`, run `npm ci`, `npm run build`,
   `npm run eslint` and `npm run knip`, plus `npx tsc --noEmit`. Record exactly what
   passes and what fails. Find out whether `next build` needs the Auth0 environment
   variables: `Auth0Client` is constructed at module load, so CI must know whether it
   needs placeholder values. Run it, don't assume.
2. **Toolchain and gates.**
   - Scripts: `typecheck`, `lint`, `format:check`, `test`, `test:coverage`, `verify`
     (format + lint + types + tests), `build`.
   - The current Prettier config stays: double quotes, width 100. Never reformat the
     repo to the API's style.
   - Add **Vitest + React Testing Library** with a first real test set:
     - `formatDate`;
     - `validation.ts`;
     - the i18n dictionaries: every language has every key, which the `Dictionary`
       type already enforces at compile time; add a runtime test only if it catches
       something the types can't;
     - one component test.
   - Coverage is a ratchet: start the floor at what the suite achieves, not an
     aspiration.
   - Husky: pre-commit runs lint-staged + typecheck + tests; pre-push runs
     `check-branch.sh`, `require-review.sh` and `verify`.
   - The existing pre-commit hook formats and fixes the whole `src/` tree. Replace
     that with lint-staged.
   - `.nvmrc` 24, aligned with the API (check that Next 16 and the dependencies
     support it), and `engines`.
3. **CI (0.8).** `.github/workflows/ci.yml` with these jobs:
   - static: format, lint, types, knip;
   - unit + coverage;
   - build, with placeholder Auth0 environment variables if 1. showed they are
     needed.
     Set concurrency and minimal permissions, and pin the actions to the versions the
     API uses. No E2E yet (tracker 9.6).
4. **The working model, ported.**
   - `CLAUDE.md`:
     - keep its useful project description (tech stack, structure, patterns);
     - add the API's "How work is done" section: the orchestrator/worker split, cost
       discipline, the review loop, four phases, before/while writing, before
       calling it done;
     - point to `gradfolio-api/docs/tracker.md` as the plan of record;
     - add a Commands table;
     - fix what is now false: "no backend", "10 tables", the `vercel.json` claim,
       Auth0 v3 variable names, "Next.js 15".
   - `AGENTS.md`, the review contract adapted to the frontend: the API's severity
     bar, plus:
     - rendering user HTML only through the sanitizer;
     - access tokens never in client components, browser storage or logs;
     - server-only API calls (per M2's Q11 proposal);
     - authorization UI never trusted as a guard;
     - every new string in en/ru/am;
     - accessibility regressions.
   - `.github/copilot-instructions.md`: the same bar, condensed, as in the API.
   - `scripts/check-branch.sh`, `scripts/require-review.sh`,
     `scripts/request-review.sh` and `scripts/review-status.sh`, copied from
     gradfolio-api with the repo slug detected, not hardcoded. Keep the
     review-status regression test by porting `src/testing/review-status.test.ts` to
     Vitest here.
   - `.review/`: README, `stacks` = `gradfolio-web`, and an empty `rules/` file.
   - `.claude/skills/gradfolio-web-review/SKILL.md` and the parallel workflow,
     adapted to Next.js lenses (security, rendering, auth, i18n, accessibility).
   - `docs/`: a README index, plus a note that the tracker lives in gradfolio-api.
5. **Repo hygiene and community files**, as in the API:
   - `.editorconfig`, `.gitattributes`, `.vscode/`;
   - LICENSE (MIT, Levon Asatryan);
   - CODE_OF_CONDUCT, CONTRIBUTING, SECURITY (scoped to the frontend: stored XSS,
     token handling, auth UI);
   - PR and issue templates;
   - `dependabot.yml` (npm grouped, actions; Node major ignored);
   - `.env.example` with the Auth0 v4 names and the API base URL.

Out:

- Any feature, page or API wiring (that is M2's frontend tasks and later).
- F1–F5 code fixes, which belong to their modules. F6 docs only.
- Any change to `gradfolio-api`.

## Known constraints

- The frontend is deployed on Vercel from `main`. Nothing you merge may break the
  Vercel build. Confirm `npm run build` passes on your final head, and that the
  Vercel check on the PR (if present) is green.
- The two-reviewer rule applies here too: GitHub Copilot and Codex on every push.
  Check whether the Codex app is installed on this repo (Codex's reaction to a
  `@codex review` comment). If it isn't, report it: installing it is Levon's job.
  Copilot's quota is exhausted, so "Copilot: FAILED" is expected until Levon decides.

## Deliverables

1. **Plan first:** `docs/setup-plan.md`, as the first PR in `gradfolio`. It holds the
   baseline results, what you will add, the PR split and open questions (for
   example, the Auth0 variables for the build). **Stop and report after it opens.**
2. After approval, 2 or 3 PRs in `gradfolio`. Suggested split:
   - (a) the toolchain: scripts, Vitest with its first tests, hooks, CI;
   - (b) the working model: CLAUDE.md, AGENTS.md, Copilot instructions, review
     scripts, `.review/`, the skill, templates, docs;
   - (c) hygiene and community files.
3. `docs/setup-verification.md`, the final test record.

## Phase 1: Investigation

1. The baseline in scope item 1, with real command output.
2. Does the dependency tree install and build on Node 24? Next 16 / React 19 /
   MUI 7 peer ranges.
3. What does Vercel run (build command, Node version, environment)? Read the project
   configuration you can see, and ask Levon only for what the repo cannot tell you.
4. Vitest with Next.js App Router components: the current recommended setup (jsdom
   vs happy-dom, `@vitejs/plugin-react`, the `@/` path alias, MUI and Emotion in
   tests). Run a spike, don't recall it.
5. `knip`'s current output: which findings are real and which are configuration
   noise.
6. How the review scripts' `gh` calls behave on this repo (detected slug, and whether
   the Codex app is present).

## Phase 2: Implementation

Per the approved plan, with commits split by logical change. Every new gate is shown
failing when it should: a pre-push on `main`, a push without a receipt, a lint error
in CI, a failing test in CI.

## Phase 3: Revalidation, the final test

Record everything in `docs/setup-verification.md`: each command, its output, and
PASS or FAIL.

1. **Fresh clone** from your worktree:

   ```sh
   git clone <worktree> <dir> && git -C <dir> checkout <branch>
   ```

   then `npm ci`, `npm run verify`, `npm run test:coverage` and `npm run build`, all
   green.

2. **Hooks:**
   - a commit with a lint error is refused;
   - a push from `main` is refused;
   - a code push without a receipt is refused;
   - a docs-only push passes.
3. **CI:** every job is green on the head commit of each PR. A deliberately broken
   commit (a lint error, and a failing test) turns the matching job red; show the
   runs, then revert.
4. **Review scripts:**
   - `request-review.sh` requests both reviewers on a real PR here;
   - `review-status.sh` reports correctly;
   - the ported regression test passes, and fails against a version with the head
     binding removed.
5. **Vercel:** the preview for your last PR builds. If you can't see it, say so.
6. **The app still runs:** `npm run dev`, then open `/`, `/profile/u_001`,
   `/projects` and `/search` locally. Each renders as before, because no behaviour
   has changed.
7. **A new frontend chat can start cold:** re-read your `CLAUDE.md` as if you were a
   new worker, and check every command in its Commands table runs.
8. **Machine clean:** stop the dev servers, remove scratch clones, and remove your
   worktree after the last merge.

## Phase 4: Re-review

- Run the repo's own new review skill. It won't be loaded in your session, so run
  its passes by hand and write the receipt with an honest `method`.
- **Both reviewers on every push** (`sh scripts/request-review.sh <pr>` once it
  exists; before that, `gh pr edit <n> --add-reviewer @copilot` and a PR comment
  `@codex review -- head <sha>`).
- Two rounds, then fix-now findings only. The last fix push gets one confirmation
  round on the head commit.
- One push per round. Resolve each thread once its fix is verified.

## Stop points

- After the plan PR: stop and report.
- Do not merge. Do not push to `main`. Do not edit `gradfolio-api` in any way,
  including its tracker. Propose tracker changes in your report.

## When to report

Send one report per pull request, when it is finished, plus the plan stop point. Send
it to the orchestrator session **gradfolio-repos-94** with SendMessage, in the format
from `gradfolio-api/docs/handoff-template.md`, part 2. If that session is not listed
in ListAgents, write the report to
`/Users/levon/Dev/university/gradfolio-repos/fe-setup-report.md`.

List anything Levon must do himself under "Open questions". Examples:

- install the Codex app on this repo;
- turn on auto-delete of head branches;
- set Vercel environment variables;
- set branch protection.
