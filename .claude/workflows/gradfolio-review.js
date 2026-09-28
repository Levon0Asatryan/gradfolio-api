export const meta = {
  name: 'gradfolio-review',
  description:
    'Adversarial pre-push review: independent reviewers by lens, each finding attacked by a separate agent, then ranked. Writes .review/.last-review.json so the pre-push gate passes.',
  phases: ['Gather', 'Review by lens', 'Attack the findings', 'Rank and record'],
};

phase('Gather');

const ctx = await agent(
  `Collect the review context for the current branch. Do not review anything yet.
Return: the diff against origin/main (paths and full patch), the contents of
.review/rules/gradfolio.md, the milestone plan docs/mN-plan.md this branch
implements if one applies, the "Code Review Rules" section of AGENTS.md, and
the current HEAD sha.`,
  {
    schema: {
      type: 'object',
      required: ['sha', 'files', 'diff', 'rules', 'plan', 'contract'],
      properties: {
        sha: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        diff: { type: 'string' },
        rules: { type: 'string' },
        plan: { type: 'string' },
        contract: { type: 'string' },
      },
    },
  },
);

if (!ctx) return 'Could not gather the branch context; nothing reviewed.';

const lenses = [
  { label: 'correctness', brief: 'Wrong results that look plausible: boundaries, units, rounding, time zones (DATETIME is zoneless; session must be UTC), YYYY-MM strings, case-sensitive tag matching, FULLTEXT short-token gaps, snake_case/camelCase mapping.' },
  { label: 'concurrency', brief: 'Duplicates, lost updates, races, deadlocks: first-login user provisioning on auth0_id, multi-statement writes outside a transaction (replace-all skills, reorder), FK share locks on parents, InnoDB gap locks, check-then-act across queries.' },
  { label: 'security', brief: 'Ownership: every write scoped to the caller, zero-row writes become 404. Visibility: is_public on every public read path. Private fields (birthday, phone, tokens, auth0_id) never in public responses. description_html allow-list sanitized on write. JWT signature/issuer/audience/expiry. SSRF on imports. Injection. Secrets in logs.' },
  { label: 'tests', brief: 'Tests that cannot fail: for every guard name the test and what removing it breaks; every authz guard has a second-user-gets-404 test; races forced by sleeps; integration tests on anything but real MySQL 8.4; assertions satisfiable a second way.' },
  { label: 'contract', brief: 'The plan\'s normative sentences, each pointed at its implementing line; the API document in step with the code; limits from validated config; response shapes the frontend (../gradfolio/src types) can consume.' },
  { label: 'architecture', brief: 'Trace one request hop by hop: token → caller → validation → service → SQL → response mapping. Layer boundaries; who owns the SQL and the schema; what the next milestone depends on.' },
];

phase('Review by lens');

const reviews = await pipeline(lenses, (lens) =>
  agent(
    `You are reviewing one lens of a gradfolio-backend branch: ${lens.label}.
${lens.brief}
Report ONLY what the severity contract allows. One finding per defect. For
each: file:line, one sentence, and the concrete failure. Cite any fact you
assert. Finding nothing is a valid answer.

HEAD: ${ctx.sha}
Changed files:
${ctx.files.join('\n')}
Rules corpus:
${ctx.rules}
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

const lost = reviews.filter((r) => !r).length;
if (lost > 0) log(`${lost} of ${lenses.length} lenses returned nothing — findings may be incomplete.`);

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

const report = await agent(
  `Rank these surviving findings, most severe first, and deduplicate ones that
are the same defect seen through two lenses. Then write .review/.last-review.json
containing exactly:
{"sha": "${ctx.sha}", "at": "<ISO timestamp from the date command>", "findings_open": <deduplicated count>, "method": "gradfolio-review-workflow", "lenses": ${lenses.length}, "attacked": ${found.length}, "rejected": ${found.length - survived.length}}
Do not round findings_open down.
Findings:
${JSON.stringify(survived, null, 2)}
Return the ranked findings and one line on how many were raised, rejected, and
what the receipt says.`,
  { label: 'rank and write receipt' },
);

return report ?? 'Review ran but the ranking agent returned nothing; receipt not written.';
