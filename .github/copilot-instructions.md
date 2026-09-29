# Review instructions for GitHub Copilot

gradfolio-api is the NestJS 12 / TypeScript backend for Gradfolio, a student
portfolio platform (university coursework), on MySQL 8.4. **The full review contract
is `AGENTS.md`, section "Code Review Rules"** — the same one Codex follows. Apply it;
the essentials:

Report a finding **only** if it is one of:

- a wrong result a user would read and trust;
- a security hole — injection, SSRF, a secret or private field (birthday, phone,
  tokens, `auth0_id`) in a response or log, an authorization gap (a write not scoped to
  its owner; another user's resource answering anything but 404; private content on a
  public path);
- data loss or corruption, including a lost update or a half-committed multi-step
  write;
- a concurrency defect — duplicate, race, deadlock;
- a broken build or test, or a test that cannot fail;
- a resource leak in the long-running process;
- code contradicting `docs/mN-plan.md`, an ADR, `openapi.yaml` or the requirements.

Do **not** report: formatting, naming, import order or type errors (CI blocks those);
"consider"/"cleaner"/"more idiomatic" suggestions; defensive code for inputs already
excluded by types or validated config; hardening only useful at a scale this project
will never reach; anything already deferred in `docs/tracker.md`.

One comment per defect. State the concrete failure — input, wrong behaviour, why —
and cite any fact you assert (a limit, a default, a library's behaviour); the author
checks premises and pushes back with evidence when one is wrong.

MySQL facts this code relies on (verified, see `docs/investigation.md`): the app
generates UUID ids; the session time zone is UTC; JSON columns and `YYYY-MM` strings
are validated only by the API; `JSON_CONTAINS` is case-sensitive; FULLTEXT ignores
tokens shorter than 3 characters; MySQL commits DDL implicitly.
