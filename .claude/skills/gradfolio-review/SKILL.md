---
name: gradfolio-review
description: Review gradfolio-api changes against this repository's own mined rules in .review/rules/, before pushing. Passes — mechanical checks, the rule corpus, an architecture pass that traces one request end to end and checks the change against the plan and ADRs, then an adversarial pass. Use before the first push of a PR, and after fixing review findings. Scoped entirely to this repository.
---

# gradfolio-review

The review that runs **before** the first push, so the reviewer sees finished
work. Every finding here is a review round that never happens.

**Scope.** Reads `.review/rules/`, `AGENTS.md`, `CLAUDE.md`, the milestone plan
in `docs/mN-plan.md`, the project's ADRs, and `docs/investigation.md`. It reads
and writes no rule corpus outside this repository.

Invoked:

- `/gradfolio-review` — the branch diff against `origin/main`
- `/gradfolio-review --fix-round` — pass 0 plus the blast radius of the fix
- `/gradfolio-review <path>` — one file or directory

## Pass 0 — mechanical (always, seconds)

Run the commands from `CLAUDE.md` → "Commands" and report failures as a block:
**verify**, **coverage ≥ threshold**, **integration** (real MySQL 8.4). Until M0
fills that table there is nothing to run: say so under NOT CHECKED.

Then the `**Check:**` regexes in `.review/rules/gradfolio.md` against the changed
files, reporting file:line plus the message. A match is a pointer for pass 1 to
judge, not a failure by itself: correct code can match. Every command must have
run; one that did not is not clean. If a command fails, stop — there is no point
reviewing code that does not build.

## Pass 1 — the rule corpus

For each rule in `.review/rules/gradfolio.md`, and each rule in `AGENTS.md`'s
"Security" and "MySQL specifics" sections, ask whether this diff could violate
it; check the ones that apply. Weight the rules that produced wrong results or
authorization gaps.

## Pass 2 — architecture, end to end

- **Trace one request end to end**, hop by hop — frontend call → token
  verification → caller resolution (`sub` → `users.id`) → validation → service →
  SQL → response mapping (snake_case → camelCase, private fields dropped) — and
  say what this change alters at each hop. A change that cannot be traced is in
  the wrong place.
- **Check the boundaries** the architecture fixes: which layer may import which,
  who owns the SQL, where the schema lives (per the M0 plan).
- **For every endpoint touched: name the ownership predicate and the visibility
  predicate**, and the test where a second user gets 404.
- **Walk the plan's normative sentences** — every "must", "is anchored on",
  "is excluded from" — and point at the implementing line. A missing one is a
  finding.
- **Check what the next milestone needs** from this change, and what the
  frontend (`../gradfolio/src`) will have to change to consume it.

## Pass 3 — adversarial

Knock down your own findings: is the premise true (verify limits, defaults,
specs, library behaviour against the source or by running it on MySQL 8.4)?
Would the test actually fail — for every guard, name the test and what removing
the guard makes fail? Is it a nit the severity contract excludes?

**A reviewer that mutates the tree runs alone** — never alongside one that
reads it, or the reading one reports defects that do not exist.

## Output

PASS 0 / PASS 1 / PASS 2 / PASS 3 summary, then FINDINGS ranked by severity
(file:line — one sentence, then the concrete failure: input → wrong output),
then NOT CHECKED. "Nothing" is a valid finding list.

## The receipt — this is what unblocks the push

Write `.review/.last-review.json` **every time**, with the real count:
`{"sha": "<git rev-parse HEAD>", "at": "<ISO timestamp>", "findings_open": <N>, "method": "gradfolio-review"}`

- `N` is every finding still open: each FINDING above, plus one per pass 0 failure.
  `scripts/require-review.sh` refuses the push unless it is `0`.
- `N` reaches `0` only by fixing (then re-running this review on the new commit) or
  by an explicit deferral recorded in the PR with a follow-up tracker row. Deferring
  is a decision to record, not a way to reach zero.
- A pass that did not run (pass 0 stopped early, NOT CHECKED items) is not clean:
  say so, and do not write `0` for it.
- A hand-written receipt uses an honest `method`, and the PR says which passes ran.

## After the review

Fix what holds up before the first push. A recurring finding not yet in the
corpus is added there with its `**Why:**` and source PR.
