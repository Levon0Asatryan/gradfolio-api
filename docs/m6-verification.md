# M6 verification: discovery and dashboard (API)

What was run for tasks 6.1 to 6.5 and the suggestions endpoint, and what it produced.
Plan: [m6-plan.md](m6-plan.md). Everything below was run on **MySQL 8.4.11** (compose
project `gradfolio-m6`) unless it says production.

| PR  | What                                                     | State (2026-10-11)                                  |
| --- | -------------------------------------------------------- | --------------------------------------------------- |
| #62 | plan                                                     | merged                                              |
| #63 | (a) search, tag pages, forwarded client address (D4)     | merged, deployed                                    |
| #64 | perf seed fixes (four #63 review threads)                | merged                                              |
| #65 | (b) browse, directory, facets, tag cloud, migration 0007 | merged, deployed                                    |
| #66 | (c) `GET /v1/me/dashboard`                               | merged, deployed                                    |
| #67 | `GET /v1/search/suggestions`                             | merged (`287708a`); deploy in progress when written |
| #68 | this record                                              | merged                                              |
| #69 | facet spelling made deterministic (defect from #65)      | merged                                              |
| #70 | this refresh                                             | open                                                |

Sections marked **pending** need a step only Levon can take (M6-T2) or a deploy that has
not happened. They are left empty rather than guessed.

## 1. Method

- Four phases per PR (CLAUDE.md): investigation (plan §1, run), implementation,
  revalidation (full gate, guard removal, real run), re-review.
- **Review.** #62 to #65 had Codex rounds (threads resolved; findings below). From #66 on
  Codex's quota was exhausted: each PR body carries a written self-review receipt
  (what was read, run, removed, not checked). Both reviewers were still requested on every
  push.
- Evidence database: `db:seed:perf`, 1,000 users and 3,000 projects in en/ru/am, 5,000
  activities, 105 private profiles and 656 unpublished projects (so a leak would show).
- Not shown: nothing was run against production data.

## 2. The gate after #67

Measured on #67's head `87ca253`, which is `main` at `fa110c9` (#69) plus #67's one
commit; the same tree as `287708a` apart from the squash.

| Check       | Result                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| verify      | green (format, lint, types, OpenAPI check, 912 unit tests)                                                              |
| coverage    | 95.8 % statements, 93.7 % branches, 94.4 % functions, 96.6 % lines                                                      |
| integration | 43 files, 745 tests                                                                                                     |
| CI on #67   | all five jobs green on `87ca253` (unit + coverage, format/lint/types/OpenAPI, integration, migrations, container stack) |

History of the count: 906 unit / 697 integration after #65; 909 / 716 with #66; 912 /
745 with #67 and #69's test. Coverage stays above the 90 % floor on every metric.
CI's run on the squash commit `287708a` had not finished when this was written.

## 3. The search matrix (plan §10), real server, seeded database

Anonymous, `GET /v1/search?q=` against a built API process on the seed. `n+` means the
group has more (`hasMore`). Every response was recorded and grepped (§4).

| Query              | People | Projects | Status |
| ------------------ | ------ | -------- | ------ |
| `IoT`              | 6+     | 6+       | 200    |
| `ML`, `ml`, `Ml`   | 6+     | 6+       | 200    |
| `AI`               | 6+     | 6+       | 200    |
| `Go`               | 6+     | 6+       | 200    |
| `C#`               | 6+     | 6+       | 200    |
| `UI`, `R`          | 6+     | 6+       | 200    |
| `the chat`         | 0      | 6+       | 200    |
| `machine learning` | 0      | 6+       | 200    |
| `Արմեն`, `ԱՐՄԵՆ`   | 6+     | 0        | 200    |
| `Алёна`, `алена`   | 6+     | 0        | 200    |
| `Фёдор`, `федор`   | 6+     | 0        | 200    |
| `+(`, `"x`         | 0      | 0        | 200    |

What the counts do not show is **which** rows: that is what the integration matrix
asserts, with fixtures named so a leak reads in the failure
(`discovery/e2e/search.int.test.ts`): for each of `ML`, `AI`, `Go`, `C#`, `R`, `IoT`, an
Armenian name, a Russian name in `ё` and `е`, mixed case and `the chat`, the **exact**
set of people and project titles, for anonymous, another user and the owner of the
private work, identical; the private, draft, private-owner, pending-member and
private-team fixtures absent; substring bait (`main`, `email`, `ago`) never found.

## 4. No private field in a public response (grep)

19 search responses plus `/v1/projects`, `/v1/users`, `/v1/users/facets`, `/v1/tags/cloud`,
`/v1/tags`, `/v1/tags/projects`, `/v1/tags/people`, `/v1/search/suggestions`,
`/v1/search/people`, `/v1/search/projects` were recorded (122,320 bytes) and grepped for
`birthday`, `phone`, `auth0`, `"email"`, `contactEmail`, `access_token`,
`refresh_token`, `external_user_id`, `descriptionHtml`, `isDraft`, `isPublic`,
`linkedin`: **all absent**. The integration tests assert the exact key set of every card.

## 5. Privacy and authorization proofs

Each guard below was removed and the named test failed (all re-run on the final code of
its PR). Test files: `discovery/e2e/search.int.test.ts`, `browse.int.test.ts`,
`suggestions.int.test.ts`, `dashboard/e2e/dashboard.int.test.ts`,
`rate-limit/e2e/rate-limit.test.ts`.

| PR  | Guards removed (each fails a named test)                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #63 | published predicate; owner-public predicate; public-profile predicate; stopword dropping; letters-and-digits-only into `AGAINST`; `LIKE` escaping; cursor scope; cursor rank range; page-size maximum; `RateBudget`; proxy-secret check; forwarded-address validity; batched enrichment; sign once; accepted-members-only count; private-only-tag 404; single-character rule |
| #64 | transaction; owner excluded from team; activities insert; `*_test` refusal                                                                                                                                                                                                                                                                                                   |
| #65 | browse published, owner-public, directory public, facets public-only; one-entry education match; cloud counted once; cloud public-people-only; cursor scope per sort; cloud limit; cache ttl; single flight; browse budget; facets before `/:id`; the two indexes                                                                                                            |
| #66 | stats owner scope; stars exclude drafts; activity window; activity-count scope; feed scope; recent-projects scope; recent limit; batched technologies; feed limit                                                                                                                                                                                                            |
| #67 | people public; projects published; projects owner-public; term used by published project / public owner / public skill; `LIKE` escaping; group size; own budget; sign once                                                                                                                                                                                                   |

Second-user tests: dashboard (another token gets its own data, never the first user's
private titles, a draft they were on, or a pending invite); search and browse
(identical for anonymous, another user, the owner); a forged well-formed cursor returns
only rows of the listing (subset assertion with private rows at every rank).

## 6. The anonymous rate limit (D4)

`RateLimitGuard` believes `X-Client-IP` only with `X-Gradfolio-Proxy-Secret` equal to one
of `PROXY_SHARED_SECRETS` (constant-time, two while rotating); otherwise the connection
address and the higher `*_SHARED` numbers. Proved in `rate-limit.test.ts`: each
vouched-for visitor has their own budget on one connection; a wrong or missing secret, a
garbage address or no configured secret all fall to the shared bucket (never unlimited);
the previous secret works during rotation; a token wins over a forwarded address; the
secret never appears in a log line. **Pending:** the Secret Manager secret and the Vercel
variable (M6-T1), and observing Vercel's overwritten `x-forwarded-for` end to end.

## 7. Migration 0007

- Applied twice: the second run prints `migrations: nothing to apply`; `down` then `up`
  gives an identical schema dump (`discovery-indexes.int.test.ts`, and the existing
  all-migrations round trip).
- Additive on a database with rows: the schema differs by exactly seven `KEY` lines, rows
  untouched (the same test, starting from 0006).
- Build time on the seed: 0.45 s for all seven steps including Node's start; one BTREE
  0.027 s. FULLTEXT on the same seed: `ft_projects_search` 0.14 s, `ft_users_search`
  0.056 s with `ALGORITHM=INPLACE, LOCK=SHARED` (`LOCK=NONE` is refused; writes wait,
  reads are served); 30,000 projects 0.76 s. 0007 itself adds no FULLTEXT index.

## 8. EXPLAIN (final statements, seed above)

| Query                        | Plan                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| projects newest              | `idx_projects_browse (is_public=1, is_draft=0) (reverse)`, no sort                 |
| projects by category         | `idx_projects_browse_category (…, category='research') (reverse)`, no sort         |
| projects updated             | `idx_projects_browse_updated (…) (reverse)`, no sort                               |
| users newest                 | covering `idx_users_browse (is_public=1) (reverse)`                                |
| users school + year          | `idx_education_institution (institution='NPUA', end_year=2026)`                    |
| users year / major           | `idx_education_end_year` / `idx_education_field` (asserted in the test)            |
| search people / projects     | table scan (a `MATCH` under `OR` is not an index access): 3.5 ms / 23 ms for `IoT` |
| tag page people              | `idx_user_skills_name`                                                             |
| tag cloud                    | covering index scans + temp table, 71 ms uncached, so cached 60 s                  |
| dashboard stats / feed count | `uq_projects_user_repo`; covering range scan of `idx_activities_user_ts`           |
| suggestions (terms)          | covering scan of `terms` (PRIMARY) with an `EXISTS` probe per surviving row        |

The integration tests EXPLAIN the compiled statements at the seed's size and fail when
the index is not used or a sort appears; dropping `idx_projects_browse` or
`idx_education_end_year` by hand made them fail.

## 9. p95 (local stack, no bucket so no signing, 300 requests per route)

| Route                                   | Concurrency 1 (p50 / p95 ms)                 | Concurrency 10 (p95 ms) |
| --------------------------------------- | -------------------------------------------- | ----------------------- |
| `/v1/search` short word / long word     | 10.7 to 12.1 / 11.6 to 12.9; `IoT` 29 / 29.7 | 24 to 28; `IoT` 233     |
| `/v1/search/people`, `/projects`        | 5.3 / 5.9, 10.4 / 11.3                       | 8.9, 23.2               |
| `/v1/tags`, `/tags/projects`, `/people` | 3.3 to 8.0 / 4.7 to 8.9                      | 3.7 to 18.7             |
| `/v1/projects` (3 sorts and filter)     | 2.8 to 3.0 / 3.4 to 3.6                      | 3.3 to 8.7              |
| `/v1/users` (plain and filtered)        | 2.9 to 3.6 / 3.8 to 5.1                      | 3.9 to 4.5              |
| `/v1/users/facets`, `/v1/tags/cloud`    | 1.6 / 1.9; 1.7 / 2.0                         | 2.0; 2.1                |
| `/v1/me/dashboard`                      | 5.6 to 6.1 / 6.6 to 6.9                      | not run                 |
| `/v1/search/suggestions`                | 4.2 to 5.2 / 4.5 to 6.1                      | 13.0 to 14.7            |

`IoT` matches about 70 % of the seeded projects, so it is the worst case (23 ms in SQL,
233 ms at concurrency 10 on one core). At the project's real scale (tens of users) this
is not a limit; at 30,000 projects the same statements took 48 to 85 ms.

## 10. Defects found by running

| Found                                                                                                                                                                 | Where                        | Fixed                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| A required stopword (`+the +chat`) empties the whole `FULLTEXT` query                                                                                                 | investigation                | yes (#63: stopwords dropped)                                 |
| An operator character in `AGAINST` (`+(`, `@3`, `*`) is a syntax error, a 500                                                                                         | investigation                | yes (#63: letters and digits only)                           |
| ngram drops every bigram with `a` or `i` unless stopwords are off and all FULLTEXT indexes were dropped first                                                         | investigation                | option rejected                                              |
| `COUNT(*)` over a `MATCH` answered 737 for one row (deleted documents in the index)                                                                                   | #63 test                     | search never counts that way                                 |
| InnoDB's stopword list has 35 distinct words, not 36                                                                                                                  | #63 test                     | yes                                                          |
| The default budget (120) capped the shared bucket below the `*_SHARED` search numbers                                                                                 | #63 real run                 | yes (`RATE_LIMIT_DEFAULT_SHARED`)                            |
| Perf seed: not atomic; seated an owner on their own team; no activities; seeded `*_test`                                                                              | #63 review (Codex)           | yes (#64)                                                    |
| Education filters could match different entries                                                                                                                       | #65 test design              | yes (one `EXISTS`)                                           |
| Concurrent reads of one avatar URL each signed it                                                                                                                     | #67 test                     | yes                                                          |
| `GET /v1/users/facets` showed `npua` or `NPUA` depending on which row MySQL met first (`MIN()` ties under the case-insensitive collation; also Cyrillic and Armenian) | #65 code, found by CI on #67 | yes (#69: bytewise-first spelling, test inserts both orders) |
| An integration test that depends on the optimizer's choice flaked at 150 rows                                                                                         | #65                          | yes (seed size of the plan)                                  |

## 11. Deviations from the plan

- The grouped search is 6 + 4 statements counted at compilation, not 5; the test pins
  equality across result sizes and a ceiling.
- `RATE_LIMIT_DEFAULT_SHARED`, the `browse` and `suggest` budgets and `DISCOVERY_CACHE_S`,
  `TAG_CLOUD_*`, `FACET_MAX`, `DASHBOARD_*`, `SUGGEST_SIZE` config were added.
- `sort=newest` on `/users` and `/projects` shipped with (b), not (a).
- Suggestions were not in the plan (a later request); see #67.
- CLAUDE.md and AGENTS.md word the budget rule per counter (nestjs/throttler 6.7.1).

## 12. Real-token run: **pending** (queue row M6-T2)

Needs a real Auth0 access token in a gitignored `.env`. To run, with the stack up:
`GET /v1/me/dashboard` for that account, then compare with its stored rows by SQL
(project counts by state, the three most recently updated projects, the five newest
activities, the 30-day count, `SUM(repo_stars)`), and `GET /v1/me/activities`. The local
run in §13 used a locally signed RS256 token through the real guard against seeded
accounts; it does not replace this.

## 13. Dashboard against stored rows (local signed token)

Three seeded accounts, built API process: counts by state, the three most recently
updated projects (own plus accepted-member non-draft), the five newest activities and
the 30-day count all equal the SQL result. No token: 401. p95 6.6 to 6.9 ms.

## 14. Production after deploy

Anonymous requests to the production API (`gradfolio-api-1058577031182.us-east1.run.app`),
2026-10-11, while #67's deploy was still running. Production holds only test data (a few
accounts and placeholder projects), so the results show that the routes are live and
public, not search quality.

| Request                           | Result                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `GET /readyz`                     | 200 `{"status":"ok","database":"ok"}`                                            |
| `GET /v1/search?q=AI`             | 200, both groups empty (no matching public data)                                 |
| `GET /v1/search?q=%2B%28` (`+(`)  | 200 (an operator string is not a 500)                                            |
| `GET /v1/tags?name=react`         | 404 `NOT_FOUND` (no public item uses it)                                         |
| `GET /v1/tags/cloud?limit=3`      | 200, three terms with counts and `generatedAt`                                   |
| `GET /v1/projects?limit=2`        | 200, a page of cards                                                             |
| `GET /v1/users/facets`            | 200, one school, one major                                                       |
| `GET /v1/me/dashboard`, no token  | 401 `UNAUTHENTICATED` (the route is live; #66 is deployed)                       |
| `GET /v1/search/suggestions?q=al` | **404**: #67 was not deployed yet. **Pending:** repeat once its Deploy is green. |

Still to record: the logged-in dashboard with a real token (§12, queue row M6-T2) and the
suggestions request above.

## 15. Not verified

- The real-token dashboard run, and production behaviour of suggestions (§12, §14).
- IAM `signBlob` latency for pages of 20 cards (no bucket locally; the tests assert one
  signing per distinct URL).
- The forwarded header through Vercel and Cloud Run's front end (D4).
- p95 at 30,000 rows under the final SQL for browse and suggestions.
- Armenian relevance quality (the tests assert matching, not ranking taste).
- Coverage was measured on #67's head, not on the squash commit `287708a`.
