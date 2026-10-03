export const meta = {
  name: 'gradfolio-review',
  description:
    'Adversarial pre-push review: the mechanical gate, then independent reviewers by lens, each finding attacked by a separate agent, then ranked. Writes .review/.last-review.json; the pre-push gate passes only when nothing is left open.',
  phases: ['Gather', 'Mechanical', 'Review by lens', 'Attack the findings', 'Rank and record'],
};

// The open count is computed here, not by an agent, so a receipt cannot say
// clean by omission. Tested by src/testing/review-workflow.test.ts, which runs
// this file with fake agents.

phase('Gather');

const ctx = await agent(
  `Collect the review context for the current branch. Do not review anything yet.
Return: the diff against origin/main (paths and full patch), the contents of
.review/rules/gradfolio.md, the milestone plan docs/mN-plan.md this branch
implements if one applies, the "Code Review Rules" section of AGENTS.md, the
current HEAD sha, and the deferrals recorded in this branch's pull request, if
it has one: each review-thread reply or PR comment by the author that defers a
finding ("Deferred …") with its tracker follow-up row, quoted with the finding
it answers. No pull request means no deferrals.`,
  {
    schema: {
      type: 'object',
      required: ['sha', 'files', 'diff', 'rules', 'plan', 'contract', 'deferrals'],
      properties: {
        sha: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        diff: { type: 'string' },
        rules: { type: 'string' },
        plan: { type: 'string' },
        contract: { type: 'string' },
        deferrals: { type: 'array', items: { type: 'string' } },
      },
    },
  },
);

if (!ctx) return 'Could not gather the branch context; nothing reviewed.';

phase('Mechanical');

// Pass 0 of the skill. Every required check must report that it ran and how it
// exited: a check missing from the answer did not run, and a check that did not
// run is not clean. Integration tests need MySQL (docker compose up -d mysql);
// the agent reports that too, rather than silently skipping it.
const REQUIRED = ['verify', 'test:coverage', 'test:int', 'openapi:check', 'rule-checks'];

const mechanical = await agent(
  `Run these from the repository root, one at a time, and report each one's exit
code: npm run verify; npm run test:coverage; npm run test:int (start MySQL first
with docker compose up -d mysql if it is not already running); npm run openapi:check
(names: "verify", "test:coverage", "test:int", "openapi:check"). Then apply every
"**Check:**" regex in .review/rules/gradfolio.md to the changed files
(${ctx.files.length} files) and report it as the check "rule-checks" (exit 0 when
the scan completed), with each match listed separately. Report a check you could
not run with ran: false. Change nothing.`,
  {
    label: 'pass 0',
    schema: {
      type: 'object',
      required: ['checks', 'ruleMatches'],
      properties: {
        checks: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'ran', 'exitCode', 'detail'],
            properties: {
              name: { type: 'string' },
              ran: { type: 'boolean' },
              exitCode: { type: 'number' },
              detail: { type: 'string' },
            },
          },
        },
        ruleMatches: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'line', 'message'],
            properties: {
              file: { type: 'string' },
              line: { type: 'number' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  },
);

const failedChecks = REQUIRED.filter((name) => {
  const check = mechanical?.checks.find((c) => c.name === name);
  return !check || !check.ran || check.exitCode !== 0;
});
if (failedChecks.length) log(`pass 0 not clean: ${failedChecks.join(', ')}`);

// A Check regex is a pointer, not a verdict: a match can be correct code. The
// lenses judge each match like any other line of the diff.
const ruleMatches = (mechanical?.ruleMatches ?? [])
  .map((m) => `${m.file}:${m.line} ${m.message}`)
  .join('\n');

const lenses = [
  {
    label: 'correctness',
    brief:
      'Wrong results that look plausible: boundaries, units, rounding, time zones (DATETIME is zoneless; session must be UTC), YYYY-MM strings, case-sensitive tag matching, FULLTEXT short-token gaps, snake_case/camelCase mapping.',
  },
  {
    label: 'concurrency',
    brief:
      'Duplicates, lost updates, races, deadlocks: first-login user provisioning on auth0_id, multi-statement writes outside a transaction (replace-all skills, reorder), FK share locks on parents, InnoDB gap locks, check-then-act across queries.',
  },
  {
    label: 'security',
    brief:
      'Ownership: every write scoped to the caller, zero-row writes become 404. Visibility: is_public on every public read path. Private fields (birthday, phone, tokens, auth0_id) never in public responses. description_html allow-list sanitized on write. JWT signature/issuer/audience/expiry. SSRF on imports. Injection. Secrets in logs.',
  },
  {
    label: 'tests',
    brief:
      'Tests that cannot fail: for every guard name the test and what removing it breaks; every authz guard has a second-user-gets-404 test; races forced by sleeps; integration tests on anything but real MySQL 8.4; assertions satisfiable a second way.',
  },
  {
    label: 'contract',
    brief:
      "The plan's normative sentences, each pointed at its implementing line; the API document in step with the code; limits from validated config; response shapes the frontend (../gradfolio/src types) can consume.",
  },
  {
    label: 'architecture',
    brief:
      'Trace one request hop by hop: token → caller → validation → service → SQL → response mapping. Layer boundaries; who owns the SQL and the schema; what the next milestone depends on.',
  },
];

phase('Review by lens');

const reviews = await pipeline(lenses, (lens) =>
  agent(
    `You are reviewing one lens of a gradfolio-api branch: ${lens.label}.
${lens.brief}
Report ONLY what the severity contract allows. One finding per defect. For
each: file:line, one sentence, and the concrete failure. Cite any fact you
assert. Finding nothing is a valid answer.

HEAD: ${ctx.sha}
Changed files:
${ctx.files.join('\n')}
Rules corpus:
${ctx.rules}
Lines the corpus's Check regexes matched (pointers: judge each, most are fine):
${ruleMatches || 'none'}
Severity contract:
${ctx.contract}
Plan:
${ctx.plan}
Diff:
${ctx.diff}`,
    {
      label: lens.label,
      schema: {
        type: 'object',
        required: ['findings'],
        properties: {
          findings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['file', 'line', 'claim', 'failure'],
              properties: {
                file: { type: 'string' },
                line: { type: 'number' },
                claim: { type: 'string' },
                failure: { type: 'string' },
                rule: { type: 'string' },
              },
            },
          },
        },
      },
    },
  ),
);

// Index-aligned with `lenses`: a failed agent resolves to null and must keep
// its slot, or every later finding is attributed to the wrong lens.
const found = reviews.flatMap((r, i) =>
  (r?.findings ?? []).map((f) => ({ ...f, lens: lenses[i].label })),
);

// A lens that returned nothing did not review its part; that is open, not clean.
const lost = reviews.filter((r) => !r).length;
if (lost > 0)
  log(`${lost} of ${lenses.length} lenses returned nothing; each counts as an open finding.`);

phase('Attack the findings');

const verdicts = await pipeline(found, (f) =>
  agent(
    `Try to knock this review finding down. You did not write it.
FINDING (${f.lens}) ${f.file}:${f.line}
${f.claim}
Failure claimed: ${f.failure}
Read the code. Is the premise true (verify against source, not memory)? Does
the failure follow — construct the input? Is it excluded by the severity
contract? Return CONFIRMED only when you built the failing case, PLAUSIBLE when
real but unconstructed, REJECTED with the reason otherwise.`,
    {
      label: `${f.file}:${f.line}`,
      schema: {
        type: 'object',
        required: ['verdict', 'reason'],
        properties: {
          verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REJECTED'] },
          reason: { type: 'string' },
        },
      },
    },
  ),
);

const survived = found
  .map((f, i) => ({ ...f, ...(verdicts[i] ?? { verdict: 'PLAUSIBLE', reason: 'not attacked' }) }))
  .filter((f) => f.verdict !== 'REJECTED');

phase('Rank and record');

const ranked = survived.length
  ? await agent(
      `Rank these surviving findings, most severe first, and merge ones that are the
same defect seen through two lenses. For each ranked finding, list in "sources"
the numbers of every finding below it covers: together they must cover every
number. Mark a finding deferred ONLY when one of the recorded deferrals below
answers that same defect, and copy that deferral into "deferral" exactly as it
appears in the list. Do not write any file.
Recorded deferrals:
${ctx.deferrals.length ? ctx.deferrals.join('\n') : 'none'}
Findings:
${survived.map((f, i) => `${i}. ${JSON.stringify(f)}`).join('\n')}`,
      {
        label: 'rank',
        schema: {
          type: 'object',
          required: ['findings'],
          properties: {
            findings: {
              type: 'array',
              items: {
                type: 'object',
                required: ['file', 'line', 'claim', 'sources', 'deferred'],
                properties: {
                  sources: { type: 'array', items: { type: 'number' } },
                  file: { type: 'string' },
                  line: { type: 'number' },
                  claim: { type: 'string' },
                  deferred: { type: 'boolean' },
                  deferral: { type: 'string' },
                },
              },
            },
          },
        },
      },
    )
  : { findings: [] };

// The ranking is trusted only when it accounts for every survivor; otherwise,
// or without a ranking, every surviving finding counts as open. A finding is
// deferred only by a deferral gathered from the PR, copied verbatim: the
// ranking cannot invent one.
const covered = new Set((ranked?.findings ?? []).flatMap((f) => f.sources ?? []));
const complete = ranked !== null && survived.every((_, i) => covered.has(i));
const isDeferred = (f) => f.deferred && ctx.deferrals.includes(f.deferral);
const openFindings = complete
  ? ranked.findings.filter((f) => !isDeferred(f)).length
  : survived.length;
const deferred = complete ? ranked.findings.length - openFindings : 0;
if (!complete && survived.length)
  log('the ranking did not account for every finding; all count as open.');

const findingsOpen = openFindings + failedChecks.length + lost;

const receipt = {
  sha: ctx.sha,
  at: '<ISO timestamp>',
  findings_open: findingsOpen,
  method: 'gradfolio-review-workflow',
  lenses: lenses.length,
  attacked: found.length,
  rejected: found.length - survived.length,
  deferred,
  pass0_failed: failedChecks,
  lenses_lost: lost,
};

const report = await agent(
  `Write .review/.last-review.json containing exactly this JSON, with "<ISO timestamp>"
replaced by the output of \`date -u +%FT%TZ\`. Change no other value.
${JSON.stringify(receipt)}
Then return the ranked findings, the pass 0 result and one line on the receipt.
Ranked findings:
${JSON.stringify(ranked?.findings ?? survived, null, 2)}`,
  { label: 'write receipt' },
);

return report ?? 'Review ran but the receipt agent returned nothing; receipt not written.';
