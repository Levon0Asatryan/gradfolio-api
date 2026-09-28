# Handoff template

How work moves between the orchestrator session and worker chats:

1. The orchestrator fills in part 1 and gives it to Levon.
2. Levon pastes it into a fresh chat.
3. The worker answers with part 2.
4. The orchestrator checks that report against GitHub rather than taking it on trust.

## Part 1: prompt to the worker

```text
You are a worker chat on gradfolio-api, the backend API for Gradfolio: a student
portfolio platform (NPUA coursework) that serves the Next.js frontend from MySQL 8.4.
Repo: /Users/levon/Dev/university/gradfolio-repos/gradfolio-api
(GitHub Levon0Asatryan/gradfolio-api).

Read these first, in order: CLAUDE.md, AGENTS.md, docs/tracker.md,
docs/investigation.md.

## Task
<one milestone or one plan step>

## Scope
<what is in, cited from the plan; what is explicitly out>

## Starting point
<branch to start from, PRs that must be merged first, relevant files>

## Known constraints and decisions already made
<ADRs, plan decisions, anything the worker must not re-argue>

## Deliverables
<plan doc if not yet approved | PR(s) | verification record>

## Phase 1: Investigation (before any plan or code)
- Every requirement in scope: the spec in
  /Users/levon/Dev/university/gradfolio-repos/docs/, the schema in ../gradfolio-sql,
  and the frontend types in ../gradfolio/src. List any contradictions.
- The code on main that this work touches, and the patterns to follow.
- How comparable systems solve the problem, and their published bugs and
  vulnerabilities.
- <questions specific to this topic that the investigation must answer>

## Phase 2: Implementation
Follow the approved plan. Put any deviations in the report under "Decisions made".

## Phase 3: Revalidation (before calling it done)
- Walk the plan line by line against the code. List any gap.
- Re-prove every guard by removing it, on the final code.
- Do a fresh clone and a real run where CLAUDE.md requires them. Say which applied.
- Leave the machine clean. Say what was running and confirm it is stopped.

## Phase 4: Re-review
- Finish Phase 3 before the first push. Push a PR you would merge.
- Run /gradfolio-review. It writes the receipt that the pre-push gate requires.
- After the last push, wait for the reviewer to review the head commit. Check each
  finding's premise before acting on it; push back with evidence when it is wrong.
- Two rounds, then fix-now findings only. The last fix push gets one confirmation
  round on the head commit, limited to the new commits.
- One push per round. Every fix push re-runs the full gate, plus a check of what the
  fix could have broken. Resolve each thread once its fix is verified.

## Stop points
- After writing docs/mN-plan.md: stop and report.
- Do not merge. Do not push to main.
- Do not edit the gradfolio or gradfolio-sql repos. List the changes they need in
  your report.

## When to report, and when not to
Send one report per pull request, when it is finished: pushed, CI green, the
reviewer's rounds done, threads resolved, machine clean. Do not report per push, per
review round or per fix.

Report mid-flight only in these cases, and immediately:
1. You are blocked, you have diagnosed the cause, and clearing it needs a decision
   that is not yours: scope, a credential, dropping something the plan promised.
2. Something invalidates the plan's design: a hole in its reasoning, not a
   deviation from its wording.
3. You find a defect in work that is already merged.
4. You need something outside your checkout: docs, the tracker, another repo.

Handle these yourself and put them in the report instead:
- A review round arriving: decide fix or defer against AGENTS.md, fix it or post a
  one-line deferral, resolve the thread, carry on.
- Deviations from the plan's wording: one line each under "Decisions made".
- Tests breaking while you fix review findings.
- Review tooling misbehaving.
- Defects caught by your own pre-push review.
- Anything answerable from CLAUDE.md, AGENTS.md, the plan or the tracker.

Fix or defer, resolving threads, and moving between PRs are your decisions.

Send reports to the orchestrator session <name> with SendMessage, in the format
from docs/handoff-template.md, part 2.
```

## Part 2: report from the worker

```text
## Task
## Status            done | blocked | plan ready for approval
## Pull requests     #<n> <title> — <url> — CI per job — threads resolved/total
## Investigation     key findings and sources; what each one changed
## What changed      3–8 lines: behaviour, not a list of files
## Revalidation      gaps between plan and code; fresh clone commands and results
## Re-review         self-review findings; review rounds; threads; regressions caught
                     by the post-fix gate; reviewer commit and time; deferrals
## Decisions made    anything not in the plan, with the reason
## Evidence          tests (unit, integration, coverage);
                     | guard removed | test that failed |;
                     real run: the actual requests and results, not "tested"
## Not verified      what could not be checked, and why
## Defects found     fixed or not
## Changes needed in other repos   gradfolio / gradfolio-sql, one line each
## Open questions for Levon
```
