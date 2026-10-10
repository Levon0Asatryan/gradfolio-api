# M6 plan: discovery and dashboard (API)

Tracker tasks 6.1–6.5, with 6.6 and 6.7 as stretch. Applies **Q3 = A** to search, browse,
tags and the dashboard. Builds on M3–M5 (`isPublished` / `projectVisibleTo`, `visibleTo`,
cursors, `inTransaction`, activities), all merged. `main` is at `f7003fc`.

Claims marked **run** were executed on 2026-10-10 against MySQL **8.4.11** (compose project
`gradfolio-m6`, port 3314; a second throwaway container on 3315 for the server-flag
experiments, `utf8mb4_unicode_ci` as in production), on a seeded database of **1,000 users
and 3,000 projects** in English, Russian and Armenian (§1.1). Probe scripts are outside
the repo; each fact is re-proved by a test in the PRs (§8). Frontend facts were read from
`gradfolio@b18f701`, read-only. Cloud SQL flag facts come from `gcloud sql flags list
--database-version=MYSQL_8_4` (read-only) and `gcloud sql instances describe gradfolio-db`.

## 0. What Levon decides

| ID  | Decision                                                          | Options                                                                                                                        | **Recommendation**                                                                                                                                                                             |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Short-token search (`AI`, `ML`, `Go`, `C#`, `UI`; S8)             | (a) terms registry + word-prefix `LIKE` fallback; (b) `innodb_ft_min_token_size=1`; (c) ngram                                  | **(a).** No schema or flag change, exact on `C#`, case and ё/е correct, no restart. §2.1.                                                                                                      |
| D2  | 6.6 view counting, 6.7 similar projects/people                    | each in or out                                                                                                                 | **6.6 out** (a write on every public read, bot-inflatable, no dedupe without D4(A)). **6.7 in**, as the last PR (d): read-only, no migration, 4 ms measured. §2.2.                             |
| D3  | Dashboard `githubStars`, `linkedinConnections`                    | drop both; `null` both until M7; computed `githubStars`, drop `linkedinConnections`                                            | **Keep `githubStars` as `SUM(projects.repo_stars)`, `null` when nothing is imported; drop `linkedinConnections`.** The column exists since 0004, so it is real data the day M7 fills it. §2.3. |
| D4  | Anonymous rate limit (all anonymous FE traffic shares one bucket) | (A) FE forwards the client IP with a shared secret; (B) per-route limits sized for the shared bucket; (C) A with B as fallback | **(A), with B's higher numbers as the fallback for requests without a valid secret.** The secret goes in Secret Manager and Vercel (Sensitive). §2.4.                                          |
| D5  | Whose projects appear in discovery                                | project published; or project published **and** owner profile public                                                           | **Both.** A project of a private profile would show the owner's name and avatar in a card. Direct links to that project keep working (M4 behaviour). §2.5.                                     |
| D6  | Tag-page names with `/`, `#`, `+` (`CI/CD`, `C#`, `C++`)          | path segment; query parameter                                                                                                  | **Query parameter** (`/v1/tags?name=C%23`). Path segments with `%2F` are rejected by many proxies. The FE route is still `/tags/[name]`. §3.                                                   |

D2 to D6 have no effect on the other PRs' shape except as noted; D1 and D4 change PR (a).

## 1. Investigation (run)

### 1.1 The seed

`seed.mjs` (scratch) writes 1,000 users (a third each with English, Russian and Armenian
names; 891 public), 1,000 education rows, 4,592 skills (165 distinct terms, Zipf-like,
including `AI`, `ML`, `Go`, `C#`, `UI`, `IoT`, `R`, `Գրաֆիկ դիզայն`, `Машинное обучение`),
3,000 projects (2,294 published; 8 % drafts, 15 % private), 9,517 technologies, 5,468
tags, 5,000 activities, and about 900 accepted team rows. Summaries mix English, Russian
and Armenian sentences and, for 10 % each, `AI`, ` Go and C#`, `main email … algorithm …
ago` (false-positive bait) and `ИИ`. PR (a) adds the same generator to the repo as
`npm run db:seed:perf` (deterministic PRNG, refuses a database that is not empty or named
`*_test`).

### 1.2 Current indexes (SHOW INDEX after 0001–0006)

| Table                  | Indexes                                                                                                                                                                       | Consequence for M6                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `users`                | PK, `uq_users_auth0`, `idx_users_email`, `ft_users_search (name, headline)`                                                                                                   | No index for `is_public` + sort. Browse users needs one.                                                            |
| `projects`             | PK, `idx_projects_user`, `uq_projects_user_repo (user_id, github_repo_id)`, `idx_projects_category`, `idx_projects_status`, `ft_projects_search (title, summary, ai_summary)` | Newest-first over published rows is a table scan plus filesort (§6). `is_public`/`is_draft`/`created_at` have none. |
| `project_technologies` | PK `(project_id, name)`, `idx_project_technologies_name`                                                                                                                      | Enough for tag pages and the cloud.                                                                                 |
| `project_tags`         | PK `(project_id, name)`, `idx_project_tags_name`                                                                                                                              | Same.                                                                                                               |
| `user_skills`          | PK, `uq_user_skills_user_name (user_id, skill_name)`, `idx_user_skills_name`, `idx_user_skills_user`                                                                          | Same (people for a term).                                                                                           |
| `terms`                | PK `name`                                                                                                                                                                     | Canonical spelling lookup.                                                                                          |
| `education`            | PK, `idx_education_user`                                                                                                                                                      | School, major and year filters scan the table. Needs three indexes.                                                 |
| `activities`           | `idx_activities_user_ts (user_id, timestamp, id)` (0006)                                                                                                                      | Feed and the 30-day count are covering index scans (§6).                                                            |

Every table is `utf8mb4_unicode_ci` (server and database; compose and Cloud SQL both set
it, `docs/deploy-plan.md` §1.6).

### 1.3 Collation, case and ё/е (run, `utf8mb4_unicode_ci`)

| Probe                                                       | Result                           |
| ----------------------------------------------------------- | -------------------------------- |
| `name = 'ml'` vs `'ML'` vs `'mL'` in `project_technologies` | 92 / 92 / 92 rows                |
| FULLTEXT `+УМНЫЙ` vs lower-case text                        | 118 (same as `+умный`)           |
| FULLTEXT `+Ёлочная`, `+елочная`, `+ёлочная`                 | 102 / 102 / 102                  |
| FULLTEXT `+Խելացի`, `+խելացի`, `+ԽԵԼԱՑԻ` (Armenian)         | 180 / 180 / 180                  |
| `LIKE 'Алена%'` vs `LIKE 'алёна%'` on names                 | 13 / 13                          |
| **`REGEXP_LIKE(title, '…елочная…')` against `Ёлочная`**     | **0** (case works, ё/е does not) |
| `JSON_CONTAINS('["React"]', '"react"')`                     | 0 (S9, as known)                 |

So FULLTEXT, `=` and `LIKE` are case-, accent- and ё/е-insensitive for Latin, Cyrillic and
Armenian. **`REGEXP_LIKE` is not ё/е-insensitive: M6 uses `LIKE`, never a regular
expression, for the fallback.**

### 1.4 Short tokens: the three options on the seed (run)

Truth = rows whose words equal the token (`LIKE 'ai %' OR '% ai %' …`). `projects` text
holds the seeded summaries.

| Query                                     | Truth (word) | Current FULLTEXT (min 3) | (a) fallback (§4) | (b) `ft_min_token_size=1`                       | (c) ngram (stopwords off, rebuilt)          |
| ----------------------------------------- | ------------ | ------------------------ | ----------------- | ----------------------------------------------- | ------------------------------------------- |
| `AI`                                      | 302–324      | 0                        | = truth           | 324 = truth                                     | 592 (substring: `main`, `email`, `chain`)   |
| `ML`                                      | 1,057        | 0 (`+ML*` also 0)        | = truth           | 1,057                                           | 1,057                                       |
| `Go`                                      | 297–353      | 0                        | = truth           | 297 = truth                                     | 643 (`ago`, `algorithm`, `Google`)          |
| `C#`                                      | 297–353      | 0                        | = truth (`LIKE`)  | 297 (matches the token `c`, so also `C`, `C++`) | 0 (`#` is a delimiter, one char is ignored) |
| `UI` (users)                              | 144          | 0                        | = truth           | 144 = truth                                     | 0 in the default build (see below)          |
| `ИИ` (Cyrillic)                           | 281–304      | 0                        | = truth           | 304 = truth                                     | 281                                         |
| `R`, `C`                                  | n/a          | 0                        | exact term only   | matches (1 char)                                | 0 (below the n-gram size)                   |
| `Արմեն`, `Фёдор`/`Федор`, `Алёна`/`Алена` | 39, 28, 13   | 39, 28, 13               | 39, 28, 13        | 39, 28, 13                                      | 39, 28, 13                                  |

Three findings that were not in the investigation (all **run**):

1. **A required stopword empties the whole query.** `+the +chat` returns 0 where
   `+chat` returns 75; `+an +app` returns 0. InnoDB's stopword list
   (`INNODB_FT_DEFAULT_STOPWORD`) is `a, about, an, are, as, at, be, by, com, de, en, for,
from, how, i, in, is, it, la, of, on, or, that, the, this, to, und, was, what, when,
where, who, will, with, www`. A search box must treat these like short tokens.
2. **Operator characters in the query are SQL errors.** `+(`, `@3`, `*`, `>`, `++a`,
   `+a -` return `ERROR 1064` (a 500 if passed through); `"unterminated` and `-a` do not.
   The query must be reduced to letters and digits before it goes into
   `AGAINST('…' IN BOOLEAN MODE)`.
3. **ngram with the default stopword setting silently drops every bigram that contains
   `a` or `i`** (`a` and `i` are in the stopword list): the index holds `ml, go, th, es…`
   and none of `ai, ma, si, ui, ia`. It works only when `innodb_ft_enable_stopword` is 0 at
   build time **and** every FULLTEXT index on the table was dropped first (adding the ngram
   index beside an existing one reuses the table's stopword set: still 0 hits). Writers
   must also run with the setting off. This is the strongest reason against (c).

Cost of each option:

| Option | Schema / infra change                                                                                                                                                                                                                                                                                                                   | Downtime and build (run unless marked)                                                                                                                                                                                                                                                                                                                                                                                 | Residual defects                                                                                                                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a)    | None. Two index additions in (b) are for browse, not search.                                                                                                                                                                                                                                                                            | None.                                                                                                                                                                                                                                                                                                                                                                                                                  | Word-start matching only (`LIKE 'x%' OR '% x%'`): `C#` after `(` or `-` is missed. Scans ≤ 3,000 rows in 2–10 ms; 30,000 rows 50–85 ms (§6).                                                                                                      |
| (b)    | Cloud SQL flag `innodb_ft_min_token_size` (INTEGER 0–16, **requires restart**: `gcloud sql flags list`). Same flag in compose and CI or tests drift. Existing instance flags are `character_set_server` and `collation_server`; `gcloud sql instances patch --database-flags` **replaces the whole list**, so the two must be repeated. | Instance restart (a Cloud SQL restart is of the order of a minute or more on `db-f1-micro`: **not measured**, 503 from `/readyz` meanwhile). Rebuilding both FULLTEXT indexes: 0.14 s + 0.05 s at 3,000 / 1,000 rows, 0.76 s at 30,000 projects, `LOCK=SHARED` (writes wait, reads served). A second index in the same `ALTER` is refused (`ERROR 1846`: one FULLTEXT creation at a time), `LOCK=NONE` is refused too. | `C#` degrades to the token `c`. Stopwords still drop `a`, `i`, `to`, `is`, so the fallback is still needed for those. Index grows (all 1–2 char words).                                                                                           |
| (c)    | `ngram_token_size` is already 2 (flag exists, restart); a new `WITH PARSER ngram` index; the stopword setting off for **every** writer connection (global flag, dynamic) and a table-wide FULLTEXT drop first.                                                                                                                          | Build 0.24 s (projects), 0.05 s (users).                                                                                                                                                                                                                                                                                                                                                                               | Substring matches (§1.4 table), no 1-char terms, `C#` impossible, relevance is noise for Latin text. Also two FULLTEXT indexes on the same columns make `MATCH` pick one unpredictably (seen: the default-parser index answered the ngram query). |

### 1.5 FULLTEXT online build, DDL rules (run)

| Statement                                                               | Result                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ADD FULLTEXT … ALGORITHM=INPLACE, LOCK=NONE`                           | `ERROR 1846: Fulltext index creation requires a lock. Try LOCK=SHARED.` |
| `ADD FULLTEXT … ALGORITHM=INPLACE, LOCK=SHARED` on 3,000 projects       | 0.14–0.24 s                                                             |
| the same on 30,000 projects                                             | 0.76 s                                                                  |
| `ALTER … FORCE, ALGORITHM=INPLACE` with two FULLTEXT indexes            | `ERROR 1846: InnoDB presently supports one FULLTEXT creation at a time` |
| BTREE `ADD INDEX … ALGORITHM=INPLACE, LOCK=NONE` (projects, 3,000 rows) | 0.018 s                                                                 |

**Plan consequence.** Option (a) adds **no FULLTEXT index**; the existing two serve search.
Only BTREE indexes are added (§5), all `INPLACE, LOCK=NONE`, so the previous revision keeps
serving. If Levon picks (b) instead, the rebuild is two single-statement steps with
`LOCK=SHARED`, behind the flag change.

### 1.6 What the frontend expects (read-only)

- **Search** (`src/components/search/ExplorePage.tsx`): all client-side over
  `portfolios.mock.ts` (`ProfileData`: `id, name, headline, avatarUrl, verified, skills[],
projects[{id,name,category,summary,tags}]`). The role chips (`Developers`, `Designers`,
  `Product Managers`, `Data Scientists`, `Researchers`) are a keyword heuristic over
  headline and skills; there is no category field on users. The card links to
  `/profile/{id}` and shows ≤ 3 skills and ≤ 2 projects. Highlights the query in text.
  Contract consequence: a **person** needs `skills` (≥ 3) and a short **projects** list;
  `verified` is part of the card.
- **Dashboard** (`dashboard.mock.ts`, `dashboard.types.ts`): `DashboardStats
{totalProjects, githubStars, linkedinConnections, recentActivities}`, `Project {id, title,
description, category, status, technologies[], lastUpdated}`, `Activity {id, type,
translationKey, translationParams?, timestamp, details?}`. The mock uses the keys
  `projectUpdated` and `profileViewed`; M5 deliberately has neither (m5-plan §8, §12). The
  feed already matches `GET /v1/me/activities`; `description` becomes `summary`;
  `lastUpdated` becomes `updatedAt`.
- **Contradiction to flag:** the FE `Project.description` is a one-line summary; the API's
  `description` is sanitized HTML. The dashboard contract uses `summary` and the FE renames.

### 1.7 Where the rate limiter stands

`RateLimitGuard` keys by the verified `sub`, else `req.ip` (`TRUST_PROXY=1` on Cloud Run,
proved in M2). The FE calls from its own server (Q11), so every anonymous request arrives
from Vercel's egress: one bucket for every logged-out visitor, per route. With today's
`RATE_LIMIT_SEARCH=30` per 60 s, **30 searches a minute for the entire anonymous
internet**, and one scraper locks everyone out (an availability attack, not only a cost
one). Checked in `@nestjs/throttler` 6.7.1 `generateKey`: the counter key is
`sha256(<controller class>-<handler>-<budget name>-<tracker>)`, so routes that opt into
the same named budget share its **value**, never its **counter**. Vercel's documentation
states that it overwrites `x-forwarded-for` on incoming requests to prevent IP spoofing
(`vercel.com/docs/headers/request-headers`), which is the value the FE would forward.

### 1.8 Query timings on the seed (run, `EXPLAIN ANALYZE`, MySQL 8.4.11)

All include the visibility predicates. Row counts are scanned rows, not results.

| Query                                                      | Plan (short)                                       | Actual time          |
| ---------------------------------------------------------- | -------------------------------------------------- | -------------------- |
| people, long token (`MATCH` OR skill), 1,000 users         | table scan, 852 `uq_user_skills_user_name` probes  | 2.0 ms               |
| people, short token (name/headline `LIKE` OR skill)        | table scan                                         | 1.8 ms               |
| projects, short token (`LIKE` OR tech OR tag) + owner join | table scan on p + PK lookup on owner               | 10.6 ms              |
| projects, long token (`MATCH` OR tech OR tag)              | table scan                                         | 6.1 ms               |
| the same two at **30,000 projects**                        | driven from `users` → `uq_projects_user_repo`      | 85 ms / 48 ms        |
| tag page, projects (`IN` of tech ∪ tags)                   | `idx_projects_browse` reverse, `IN` probed per row | 4.6 ms               |
| tag page, people                                           | `idx_user_skills_name` + PK                        | 0.18 ms              |
| tag cloud (tech ∪ tags ∪ skills, public only)              | covering index scans + temp table                  | 71 ms (instrumented) |
| similar projects (term overlap)                            | name indexes + PK                                  | 4.4 ms               |
| dashboard: counts, recent 3, activity count, feed 5        | `uq_projects_user_repo`, `idx_activities_user_ts`  | < 1 ms each          |

Reading: at this project's scale (tens of users, hundreds of projects) every read is
single-digit milliseconds; 10× headroom stays under 100 ms. The cloud is the one query
that is not cheap per page view: §3.4.

## 2. Decisions and options

### 2.1 D1: short tokens (S8)

Options and costs are in §1.4. **Recommendation (a).** Reasons: it is the only option with
no infra change (no Cloud SQL restart, no flag to keep equal in compose, CI and prod); it
is exact where the data is a registered term (`C#`, `C++`, `R`, `Go`) because it uses the
`terms` registry's canonical spelling, which is also what tag pages use; and it is the
only one whose false-positive rate is zero by construction. Its cost is a word-start
`LIKE`, which is a scan, measured at §1.8. If the corpus ever outgrows that, (b) is the
upgrade and the fallback code stays for stopwords, so nothing is thrown away.
Not recommended: (c), for the three findings above.

### 2.2 D2: 6.6 and 6.7

| Item                          | What it would take                                                                                                                                                                                                                                                                                                                                                                                        | **Recommendation**                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.6 view counting             | `projects.view_count BIGINT UNSIGNED NOT NULL DEFAULT 0` (INSTANT), `UPDATE … SET view_count = view_count + 1` on every non-owner `GET /projects/:id` (a write on a public read path, rate limit and replica concerns), an index for the sort. No dedupe is possible while all anonymous traffic shares one address (D4); a bot inflates the counter and "most viewed" becomes a ranking anyone can game. | **Out.** Revisit after D4(A), when per-client dedupe is possible (a `project_views` day-bucket table). Browse sorts are newest and updated. P3 stays open in the tracker. |
| 6.7 similar projects / people | `GET /v1/projects/{id}/similar`, `GET /v1/users/{id}/similar`: shared technologies and tags (or skills) ranked by overlap, same visibility predicates. Read-only, no migration, 4.4 ms measured.                                                                                                                                                                                                          | **In**, as PR (d), after (a)–(c) and the verification record, only if time remains. Hard stop otherwise: it is optional.                                                  |

### 2.3 D3: dashboard fields (F4)

| Option                                                 | For                                                                                               | Against                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Drop both                                              | Contract has nothing fake                                                                         | Adds a field later (non-breaking)                                                                     |
| `null` both until M7                                   | FE keeps the card layout                                                                          | Two permanently empty cards; `linkedinConnections` can **never** exist (Q8: LinkedIn's API is closed) |
| **`githubStars` computed, drop `linkedinConnections`** | `projects.repo_stars` has existed since 0004; the sum is real data, `null` when no project has it | M7 must keep writing `repo_stars` (it already plans to)                                               |

Recommendation: the third. `stats.githubStars` is `SUM(repo_stars)` over the caller's
published and private non-draft projects, `null` when none has a value. The FE card shows
`—` for `null` (it already does: `value ?? noData`). `linkedinConnections` is removed from
the FE types and strings.

### 2.4 D4: the anonymous bucket

| Option                                     | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | For                                                                                                                        | Against                                                                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Forwarded client IP + shared secret** | FE reads Vercel's `x-forwarded-for` (overwritten by Vercel) and sends `X-Client-IP: <ip>` and `X-Gradfolio-Proxy-Secret: <secret>` on public calls. API config `PROXY_SHARED_SECRETS` (comma list: current and previous, for rotation, never logged). In `RateLimitGuard.getTracker`: no token and a header secret that matches (`crypto.timingSafeEqual` over a fixed-length digest) and a syntactically valid IP → `ip:<forwarded>`; otherwise `ip:<req.ip>` as today. Token present: `user:<sub>` as today. | Per-visitor budgets; scrapers limited per IP; a spoofed header without the secret is ignored; also gives 6.6 dedupe later. | A leaked secret lets a caller choose its own key (it evades the limit but cannot lock out a victim except by guessing an IP). One secret in two places to rotate. FE must forward on every anonymous server call. |
| B. Per-route limits for the shared bucket  | Raise `RATE_LIMIT_SEARCH` etc. so the _sum_ of legitimate visitors fits (say 600 / min)                                                                                                                                                                                                                                                                                                                                                                                                                        | No FE change, no secret                                                                                                    | One scraper at 10 req/s exhausts the bucket for all anonymous users; limits protect the database, not the visitors. Not a scraping defence.                                                                       |
| C. A, with B's numbers for the fallback    | Requests without a valid secret (misconfigured preview, direct hits) share the address bucket at the higher B limit; valid-secret requests get the per-IP limit                                                                                                                                                                                                                                                                                                                                                | Safe on a missing secret: degrades to today, never to "unlimited"                                                          | Two numbers per budget (`RATE_LIMIT_SEARCH`, `RATE_LIMIT_SEARCH_SHARED`)                                                                                                                                          |

**Recommendation: C (A plus B's higher limit as the fallback).** Where the secret lives:

- Cloud Run: Secret Manager `gradfolio-proxy-secret`, mounted as env
  `PROXY_SHARED_SECRETS` (the migrate job does not need it). Needs `secretAccessor` for
  `gradfolio-api-run`; an ops step Levon or the orchestrator runs (`docs/deploy.md`).
- Vercel: `API_PROXY_SECRET`, **Sensitive**, Production only (previews hit the production
  API but have no secret and fall back to the shared bucket, which is acceptable and
  stated).
- Never in the repo, in `.env.example` as a value, or in logs (`redaction.ts` gets the
  header name).
- Rotation: add the new secret as the second list entry, deploy API, switch Vercel,
  remove the old entry.
- The number the API trusts is **only** parsed as an IP (`net.isIP`); IPv6 keyed by `/64`
  as the throttler already does (`ipv6SubnetPrefix`).
- **Needs from Levon:** the Secret Manager secret and the Vercel variable (queue row).
  Until they exist the API behaves as the fallback.

### 2.5 D5: owner profile visibility in discovery

Q3 = A: a private profile or project is excluded from search and browse. A _published_
project of a _private_ profile is public by its own flag, and M4 lets anyone with the link
read it (the owner's name appears; `avatarUrl` is `null`). In discovery it would put the
private user's name and picture on a card. Rule used everywhere in M6: a project is
discoverable iff `isPublished(project)` **and** `visibleTo(owner, undefined)`; a person iff
`visibleTo(user, undefined)`. This is stricter than M4's direct read on purpose and is
tested both ways (§7, X3).

### 2.6 Decisions that are not Levon's

| ID  | Decision                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | **Discovery ignores the viewer.** Search, browse, tags and the cloud call the helpers with `viewerId = undefined` (`projectVisibleTo(eb, undefined)` is `isPublished`), so the owner's own private or draft project does not appear either (the brief's matrix: owner, other user, anonymous). Responses are therefore identical for everyone and cacheable. The owner finds their work through `/me/projects`. |
| N2  | **Accepted team projects count, as the owner's profile counts them.** A person's `projectCount` is own published + accepted-member published, as `GET /users/:id` does. Membership never makes a private or draft project appear (`projectReadableBy` is never used here; m5-plan §2.3). A pending or rejected row counts for nothing.                                                                          |
| N3  | **Ranking is a deterministic integer, not `MATCH` score.** Relevance scores differ across index merges and are floats, which makes a keyset cursor unstable. `rank` is computed in SQL from the row and the query (§4.3); ties break on `(created_at DESC, id DESC)`.                                                                                                                                           |
| N4  | **Facets endpoint** `GET /v1/users/facets` supplies the school, major and year choices for the browse-users filters; free-text filters would not match the exact values the index serves.                                                                                                                                                                                                                       |

## 3. Endpoints

All under `/v1`, all in `OPERATIONS`, all with a request in `http/discovery.http` /
`dashboard.http`, all rate-limited. Errors: `400 VALIDATION_FAILED`, `401` (dashboard),
`404 NOT_FOUND` (tag with no public item, unknown cursor is `400`), `429`, `503`.
Discovery routes are `@Public()` with optional auth (the token, when present, only
changes the rate-limit key). Query objects are `z.strictObject`: an unknown key is 400.

| Method | Path                     | Task | Notes                                                                                |
| ------ | ------------------------ | ---- | ------------------------------------------------------------------------------------ |
| GET    | `/search`                | 6.1  | Grouped top results, no cursor.                                                      |
| GET    | `/search/people`         | 6.1  | Paged.                                                                               |
| GET    | `/search/projects`       | 6.1  | Paged.                                                                               |
| GET    | `/tags`                  | 6.2  | `?name=` → `TagSummary`; 404 when no public item uses the term.                      |
| GET    | `/tags/projects`         | 6.2  | `?name&limit&cursor` newest first.                                                   |
| GET    | `/tags/people`           | 6.2  | `?name&limit&cursor`.                                                                |
| GET    | `/tags/cloud`            | 6.4  | `?limit` (≤ 100, default 40). Cached.                                                |
| GET    | `/projects`              | 6.3  | Browse. `?sort&category&status&limit&cursor`.                                        |
| GET    | `/users`                 | 6.3  | Browse. `?school&major&gradYear&limit&cursor`.                                       |
| GET    | `/users/facets`          | 6.3  | `{schools, majors, years}` with counts, top 50 each. Registered before `/users/:id`. |
| GET    | `/me/dashboard`          | 6.5  | Token. The caller only.                                                              |
| GET    | `/projects/{id}/similar` | 6.7  | Stretch (PR d).                                                                      |
| GET    | `/users/{id}/similar`    | 6.7  | Stretch (PR d).                                                                      |

`GET /projects` and `GET /users` are new GETs on paths that today have only `POST /projects`
and `GET /users/lookup`, `GET /users/:id`.

### 3.1 Request rules

- `q`: NFKC-normalized, control and zero-width characters removed, trimmed, whitespace
  collapsed. Length 1–100 characters (not bytes), at most 6 tokens, each ≤ 50 characters;
  more is a 400, not a truncation.
- `limit`: integer, default `DISCOVERY_PAGE_SIZE` (12), at most `DISCOVERY_PAGE_MAX` (30);
  grouped `/search` uses `SEARCH_GROUP_SIZE` (6, max 10). All in `schema.ts`, no literals.
- `cursor`: opaque base64url, ≤ 600 characters, strict schema `{r?, t, id, s}` where `s`
  names the list (`search-people`, `search-projects`, `browse-projects:<sort>`, …) so a
  cursor from one list is a 400 on another (the `time-cursor.ts` pattern).
- `sort` (browse projects): `newest` (default), `updated`. `category` and `status` are the
  existing enums. `gradYear`: integer 1950–2100. `school`, `major`: ≤ 200 characters,
  compared with `=` under the column collation after the same normalization.
- Tag `name`: same normalization, 1–255 characters, a single term (no tokenizing).

### 3.2 Shapes (zod → `openapi.yaml`)

```ts
PersonSummary = {
  id: string, name: string, headline: string, avatarUrl: string | null,
  verified: boolean, location: string | null,
  skills: string[],            // up to 5, registry spelling, user's order
  projectCount: number,        // N2
}                              // never: email, contactEmail, phone, birthday, auth0Id, links

ProjectCard = {
  id: string, title: string, summary: string | null,
  category: 'academic'|'personal'|'research'|'hackathon'|'course'|'other',
  status: 'ongoing'|'completed'|'archived', heroImageUrl: string | null,
  technologies: string[],      // up to 5
  tags: string[],              // up to 5
  owner: { id: string, name: string, avatarUrl: string | null },
  createdAt: string, updatedAt: string,
}                              // never: description, links, files, isPublic, isDraft, aiSummary, repo

SearchResults = {
  query: string,               // normalized, echoed so the page can show what was searched
  people:   { items: PersonSummary[], hasMore: boolean },
  projects: { items: ProjectCard[],   hasMore: boolean },
}
PersonPage  = { items: PersonSummary[], nextCursor: string | null }
ProjectPage = { items: ProjectCard[],   nextCursor: string | null }   // new schema id: DiscoveryProjectPage
TagSummary  = { name: string, projectCount: number, peopleCount: number }
TagCloud    = { items: { name: string, projects: number, people: number }[], generatedAt: string }
UserFacets  = { schools: {value: string, count: number}[], majors: [...], years: {value: number, count: number}[] }

Dashboard = {
  stats: {
    projects: { total: number, published: number, private: number, draft: number },
    githubStars: number | null,          // D3
    recentActivities: number,            // activities in the last DASHBOARD_ACTIVITY_DAYS (30)
  },
  recentProjects: DashboardProject[],    // 3 by updatedAt: own, plus accepted-member non-draft (role)
  activities: Activity[],                // 5 newest, the M5 shape, unchanged
}
DashboardProject = { id, title, summary, category, status, technologies: string[],
                     role: 'owner'|'member', isPublic: boolean, isDraft: boolean,
                     updatedAt: string }
```

`heroImageUrl` and every `avatarUrl` pass through `FileUrlService.read` (signed read URLs,
M4), deduplicated per response; §8 asserts one signing per distinct key.

### 3.3 Search semantics (6.1)

Tokens are the whitespace-separated words of `q` (after §3.1). Each token is **long**
(entirely letters and digits in any script, length ≥ 3, not in the stopword list) or
**short** (anything else: ≤ 2 characters, or containing `#`, `+`, `.`, `-`, `/`, or a
stopword). Every token must match (AND across tokens, OR across fields).

- **People**, per token: long → `MATCH(name, headline)` boolean `+tok*`, **or** a skill
  equal to the token (registry spelling, case-insensitive by collation) **or** a skill
  with the word-prefix; short → word-start `LIKE` on `name` or `headline`, or a skill
  equal to the token.
- **Projects**, per token: long → `MATCH(title, summary, ai_summary)` `+tok*`, or a
  technology/tag equal to the token; short → word-start `LIKE` on `title`/`summary`, or a
  technology/tag equal to the token.
- A single-character token only matches an exact registry term (`R`, `C`); it never does a
  prefix match, so `a` is not "everything starting with a".
- The boolean string is built only from tokens that are letters and digits, so no operator
  can reach `AGAINST` (finding 2); `%` and `_` in `LIKE` patterns are escaped with the
  existing `escapeLike`; every value is bound.
- Stopword list: the 36 words above, kept in `search-tokens.ts` and **compared in a CI
  integration test with `INNODB_FT_DEFAULT_STOPWORD`**, so a server upgrade that changes
  it fails a test instead of returning silent zeros.

### 3.4 Tag cloud (6.4): cost and staleness

71 ms per uncached call at 1,000 users and 3,000 projects. The result has no per-viewer
variance (N1), so it is **cached in process for `TAG_CLOUD_CACHE_S` (60 s) with
single-flight** (concurrent misses share one query). Staleness: up to 60 s, plus a
different value per Cloud Run instance (max 3). `generatedAt` is in the response. The
cache is dropped by nothing else: a freshly published project shows within a minute,
which is stated in the OpenAPI description. Counts are distinct projects (a term that is
both a tag and a technology of one project counts once) and distinct people.

### 3.5 Browse users (6.3)

Public users, newest first (`created_at DESC, id DESC`), optionally those with an
`education` row matching `school`, `major` and/or `gradYear` (`end_year`; a user matches
when **one** row matches all given filters, not each filter on a different row: one
`EXISTS` with all conditions). A user with no education row is excluded when any filter is
set.

## 4. Query design

### 4.1 Shared predicates

```ts
// src/api/discovery/utils/discoverable.ts: the only place M6 composes visibility
const publishedProject = (eb) => projectVisibleTo(eb, undefined); // isPublished
const publicOwner = (eb) => visibleTo(eb, undefined); // users.is_public = 1
```

`discoverable.ts` exports `discoverableProjects(db)` (projects joined to
`users as owner`, both predicates applied) and `discoverableUsers(db)`. Every M6 read
starts from one of the two, so a new endpoint cannot forget a predicate; a test enumerates
the routes in `OPERATIONS` and fails if a discovery route does not appear in the
privacy matrix (§7).

### 4.2 Statement count

| Endpoint              | Statements                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/search`             | 2 candidate queries (people, projects) + 2 batched enrichments (skills for the page of people; technologies and tags for the page of projects) + 1 count of `projectCount` via `GROUP BY user_id`. Fixed: 5. |
| `/search/people`      | 1 + 2 enrichments = 3                                                                                                                                                                                        |
| `/tags/*`             | 1–3, `GET /tags` is 2 counts                                                                                                                                                                                 |
| `/projects`, `/users` | 1 + enrichments (2)                                                                                                                                                                                          |
| `/me/dashboard`       | 1 user (guard) + counts + recent + technologies + activity count + feed = 6                                                                                                                                  |

Enrichments are `WHERE id IN (page ids)`, one query per relation, never one per row; each
endpoint has a test that runs it with 1 and with 25 results and asserts the same
statement count (the pattern of `my-teams.int.test.ts`).

### 4.3 Rank (N3)

`rank` for people: 3 if `name = q` (whole normalized query), 2 if every token is a
word-start of `name`, 1 otherwise (headline or skill). For projects: 3 if `title = q`, 2
if every token is a word-start of `title` or a technology/tag equals it, 1 otherwise
(summary only). Order: `rank DESC, created_at DESC, id DESC`; cursor `{r, t, id}`
compared as a row value `(rank, created_at, id) < (?, ?, ?)` over a derived table. The
candidate set is bounded by the filters; at the measured scale the derived table is a few
thousand rows. A test pages through a 25-hit query with `limit=4` and asserts no repeat
and no gap, and that inserting a new matching row mid-pagination does not duplicate a seen
row.

## 5. Migrations (additive)

**One migration, `0007_discovery_indexes`, in PR (b).** (a) and (c) add none. All BTREE,
`ALGORITHM=INPLACE, LOCK=NONE`, one statement per step. The previous revision does not
reference them, so it keeps serving while they build; nothing is dropped or tightened.
(M7 may also want a migration; whichever merges second renumbers its file. The runner
orders by name, and both sets are independent index/column additions.)

```sql
-- up
CREATE INDEX idx_projects_browse          ON projects (is_public, is_draft, created_at, id);
CREATE INDEX idx_projects_browse_category ON projects (is_public, is_draft, category, created_at, id);
CREATE INDEX idx_projects_browse_updated  ON projects (is_public, is_draft, updated_at, id);
CREATE INDEX idx_users_browse             ON users (is_public, created_at, id);
CREATE INDEX idx_education_institution    ON education (institution(100), end_year, user_id);
CREATE INDEX idx_education_field          ON education (field(100), end_year, user_id);
CREATE INDEX idx_education_end_year       ON education (end_year, user_id);
-- down: DROP INDEX for each, reverse order
```

`institution(100)` / `field(100)`: the columns are `VARCHAR(500)` utf8mb4 (2,000 bytes,
under the 3,072 limit, but a prefix keeps the index small); the equality still uses it
(run: `Index lookup on e using idx_education_institution (institution='NPUA',
end_year=2026)`). Build time (run): 18 ms for the projects index at 3,000 rows.

Proofs, as in M5: the migration is applied twice in CI and the second run prints
`nothing to apply`; `down` then `up` yields a byte-identical `schema-dump`; `db:types`
regenerates (CI `db:types:check`); an integration test boots the **0006 schema** and runs
the existing M4/M5 endpoint tests against the 0007 database to show the old code is
unaffected (indexes cannot change results; the test is for the plan row, not a doubt).
If D2 later adds `view_count`, it is a separate migration, `ADD COLUMN … DEFAULT 0`
INSTANT.

## 6. EXPLAIN (run; PR (b) records them again against the final SQL)

| Query                                    | Before 0007                                                          | After 0007                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| projects newest, published, owner public | scan `users` (1,000), `uq_projects_user_repo` per user, **filesort** | `Index lookup on p using idx_projects_browse (is_public=1, is_draft=0) (reverse)`, **no sort**, cost 1108 → LIMIT 21 stops early |
| the same, `category = 'research'`        | `idx_projects_category` (498 rows) + **sort**                        | `idx_projects_browse_category (is_public=1, is_draft=0, category='research') (reverse)`, no sort                                 |
| users newest, public                     | table scan (1,000) + sort                                            | `Covering index lookup on u using idx_users_browse (is_public=1) (reverse)`                                                      |
| users by school + year                   | table scan on `education` (1,000), temp table to dedupe              | `Index lookup on e using idx_education_institution (institution='NPUA', end_year=2026)`, dedupe on index                         |
| tag page, people                         | `idx_user_skills_name`                                               | unchanged                                                                                                                        |
| dashboard counts / recent / activities   | `uq_projects_user_repo`; `idx_activities_user_ts` covering           | unchanged                                                                                                                        |

Not covered by an index, by choice: the word-start `LIKE '% x%'` fallback (a leading
wildcard cannot use a BTREE) and the `MATCH … OR EXISTS` form (a `MATCH` under `OR` is
evaluated per row; the optimizer scans). Measured 2–10 ms at 3,000 rows, 85 ms at
30,000 (§1.8); the plan's response, if the scale ever changes, is the union-of-candidates
form, not another index.

The tag-page projects query was planned from the sort index with an `IN` probe per row
(865 rows examined for a 92-row term). PR (b) writes it driven from the term tables
(`FROM (SELECT project_id FROM project_technologies WHERE name = ? UNION SELECT … ) t JOIN
projects …`) and keeps whichever `EXPLAIN` shows fewer rows; the choice and output are
recorded in `m6-verification.md`.

## 7. Security properties and how each is proved

Every proof is a test **seen failing with the guard removed**, recorded in the
verification doc.

| #   | Property                                                                                                                                                                                        | Proof                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | A private project, a draft and a project of a private profile never appear in `/search*`, `/tags*`, `/projects`, `/users`, the cloud, `similar`, **for the owner, another user, and anonymous** | One fixture of 8 rows per class (published, private, draft, private-owner, pending member, rejected member, accepted-member-of-private, deleted owner); every route called with 3 viewers; assert the id sets. Remove `isPublished` → fails; remove `visibleTo` on the owner join → fails (separately).     |
| X2  | A private profile is not in people search, browse, tag people, facets, or as a `ProjectCard.owner`                                                                                              | Same fixture; users with `is_public = 0` named so that the query would hit them by name, skill and headline.                                                                                                                                                                                                |
| X3  | Direct reads are not weakened: a published project of a private profile still answers `GET /projects/:id` (M4) while being absent from discovery                                                | Pair of assertions on one id.                                                                                                                                                                                                                                                                               |
| X4  | Accepted team membership never exposes a private project; a pending invitee sees nothing new                                                                                                    | Accepted member of a private project: absent from every list for the member; `projectCount` excludes it; published team project counts for owner and accepted member, not for pending/rejected.                                                                                                             |
| X5  | No private field in any discovery response                                                                                                                                                      | A key-set test on every response schema (`PersonSummary`, `ProjectCard`) plus a **grep over the recorded real responses** in the verification run for `birthday`, `phone`, `auth0`, `email`, `contactEmail`, `access_token`, `refresh_token`, `external_user_id`, `descriptionHtml`, `isDraft`, `isPublic`. |
| X6  | The `ProjectCard`/`PersonSummary` columns are listed one by one, never `selectAll`                                                                                                              | Column-list constants as in `project.repository.ts`; a test adding a column to the row type fails to compile into a response (the M4 approach) and `architecture.test.ts` rejects `selectAll` in `src/api/discovery`.                                                                                       |
| X7  | The dashboard shows only the caller's rows; nothing of another user                                                                                                                             | Two users with overlapping team projects: A's dashboard never includes B's private title, B's activities, or A's pending-invite project; a `teamJoined` activity carries only the title the member may see (m5-plan §8). Second user's token → own data only. Remove `WHERE user_id = ?` → fails.           |
| X8  | Query injection and syntax: operators, quotes, `%`, `_`, `\`, NUL, 10 KB strings, lone surrogates, mixed scripts                                                                                | Table-driven test over the finding-2 strings: 200 with an empty or correct result, never 500; 101 characters and 7 tokens are 400. Remove the sanitizer → the `+(` case returns 500 (proved).                                                                                                               |
| X9  | Short-token and stopword behavior: `AI`, `ML`, `Go`, `C#`, `UI`, `the chat`, `IoT`, `an app`, `R`                                                                                               | The search matrix in §10.                                                                                                                                                                                                                                                                                   |
| X10 | Case, ё/е and Armenian case                                                                                                                                                                     | `Алёна`/`алена`/`АЛЕНА`; `Фёдор`/`Федор`; `Արմեն`/`ԱՐՄԵՆ`; one row each in people and projects; skills and tags the same.                                                                                                                                                                                   |
| X11 | Cursor forgery and cross-list reuse: another list's cursor, a tampered rank, a negative `t`, `id` of 5 KB                                                                                       | 400 `VALIDATION_FAILED`, never a page.                                                                                                                                                                                                                                                                      |
| X12 | Tag page `name` is data: `'; DROP`, `%`, `\`, a 255-character name                                                                                                                              | Bound parameters; the unknown-tag 404 equals the private-only-tag 404 (no existence oracle).                                                                                                                                                                                                                |
| X13 | The forwarded-IP header is honored only with the secret (D4)                                                                                                                                    | Without secret, wrong secret, previous secret (accepted during rotation), garbage IP, IPv6, header present with a token (token wins): each asserted by which bucket 429s. Remove the secret check → forged-IP request chooses its own bucket (proved by test). Barrier, not sleep, for the window.          |
| X14 | Every new route is rate limited, and a budget is per route                                                                                                                                      | A test that reads `OPERATIONS` and asserts each M6 route has `RateBudget` metadata, and that the 31st request to `/search/people` is 429 while `/search/projects` still answers.                                                                                                                            |

## 8. Other tests

- **Contract:** `document.test.ts` (served = documented); `npm run openapi` diff; every
  route has its `http/` request.
- **No N+1:** statement counting through the Kysely `log` hook (the helper from
  `my-teams.int.test.ts`), 1 vs 25 results, for every list route and the dashboard (§4.2).
  Remove the batched `IN` and put a per-row query → fails.
- **Signing:** with a stub `FileStorage` counting `signRead`, a page of 20 cards signs each
  distinct key once and a second call signs nothing (cache). Production signs through IAM
  `signBlob`, whose latency and quota are an open M4 "not verified"; the p95 below is
  measured without a bucket and says so.
- **Pagination:** stable under concurrent insert (N3), `limit` bounds (0, 1, max, max+1),
  an empty last page, `nextCursor` null at the end.
- **Tokenizer unit tests** (pure): classification of each sample in §1.4, stopwords, the
  boolean builder never emitting an operator.
- **Seed/perf (local, recorded, not a CI gate):** `db:seed:perf`, then 500 requests per
  route at concurrency 1 and 10 against the compose API; p50/p95/p99 and the `EXPLAIN` of
  each final statement go in `m6-verification.md` with the machine described.
- **Migration:** §5.

## 9. Rate limits

| Route                                                                             | Budget (existing name, per-route counter)                    | Default (valid forwarded IP / token) | Fallback (shared address) |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ | ------------------------- |
| `/search`, `/search/people`, `/search/projects`                                   | `search`                                                     | 30 / 60 s                            | 300 / 60 s                |
| `/tags`, `/tags/projects`, `/tags/people`, `/projects`, `/users`, `/users/facets` | new `browse`                                                 | 60 / 60 s                            | 600 / 60 s                |
| `/tags/cloud`                                                                     | `browse` (served from the cache; the query is single-flight) | 60 / 60 s                            | 600 / 60 s                |
| `/me/dashboard`                                                                   | default (authenticated, own data)                            | 120 / 60 s                           | n/a                       |
| `/projects/{id}/similar`, `/users/{id}/similar`                                   | `browse`                                                     | 60 / 60 s                            | 600 / 60 s                |

**On "never give two routes one budget"** (CLAUDE.md, AGENTS.md): the rule exists so one
route cannot exhaust another's allowance. Run against `@nestjs/throttler` 6.7.1 (§1.7)
the counter key includes the controller class and handler, so routes opting into the same
named budget share its _limit value_ and never a _counter_. X14 proves it (the 31st
`/search/people` is 429 while `/search/projects` answers) and PR (a) proposes the one-line
wording fix to CLAUDE.md. If a reviewer holds to the letter, the fallback is one named
budget per route, which is mechanical.

Config adds `RATE_LIMIT_BROWSE`, `RATE_LIMIT_SEARCH_SHARED`, `RATE_LIMIT_BROWSE_SHARED`
(`schema.ts`, bounded like the others). The default 120 / 60 s per route also applies.
The throttler's `skipIf` pattern is unchanged; the guard picks the shared number when the
tracker is an address bucket without a valid secret.

## 10. Final test matrix (the brief's, made concrete)

For each row the request is made **anonymous, as a second user, and as the owner**; the
expected set is identical for all three (N1), and the private, draft, pending and
private-owner fixtures are absent.

| Query                               | People expected                    | Projects expected                                               | Path exercised               |
| ----------------------------------- | ---------------------------------- | --------------------------------------------------------------- | ---------------------------- |
| `IoT`                               | users with skill/headline IoT      | published with technology IoT, or text `IoT`                    | long token, FULLTEXT + term  |
| `ML`                                | skill `ML`, headline `ML engineer` | technology `ML`, summary word `ML`                              | short, registry + word-start |
| `AI`                                | skill `AI`                         | technology `AI`, summary `… with AI …`; **not** `main`, `email` | short                        |
| `Go`                                | skill `Go`                         | technology `Go`, word `Go`; **not** `ago`, `Google`             | short                        |
| `C#`                                | skill `C#`                         | technology `C#`                                                 | short with punctuation       |
| `ai` / `AI` / `Ai`                  | same set                           | same set                                                        | case                         |
| an Armenian name (`Արմեն`, `ԱՐՄԵՆ`) | users of that name                 | projects titled with Armenian words                             | collation                    |
| a Russian name (`Алёна`, `алена`)   | same set for both spellings        | `Ёлочная`/`елочная`                                             | ё/е                          |
| `the chat`, `an app`                | n/a                                | results for `chat` / `app` (stopword not required)              | finding 1                    |
| `machine learning`                  | two tokens, AND                    | AND                                                             | multi-token                  |
| `+(`, `"x`, `@3`, `*`               | 200, empty or literal match        | same                                                            | finding 2                    |

Beyond search: a fresh clone passes `verify`, `test:coverage` (≥ 90 %) and `test:int`;
the grep of X5 over real responses; p95 and EXPLAIN recorded; **the real-token run**
(queue row below) compares `GET /me/dashboard` for a real account with its stored rows
(counts by SQL, the three most recently updated projects, the five newest activities, the
30-day count); on production after deploy `/readyz` 200, an anonymous `GET /v1/search?q=AI`
and `GET /v1/tags?name=...`; OpenAPI check; plan walk; guard proofs; CI green; machine
clean.

## 11. PR breakdown

| PR   | Content                                                                                                                                                                                                                                                                                        | Migration |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| plan | This document.                                                                                                                                                                                                                                                                                 | none      |
| (a)  | `discoverable.ts`; tokenizer and stopword test; `/search`, `/search/people`, `/search/projects`, `/tags`, `/tags/projects`, `/tags/people`; `search`/`browse` budgets and **D4** (secret header, config, guard); OpenAPI; `http/discovery.http`; `db:seed:perf`; privacy matrix X1–X4, X8–X14. | none      |
| (b)  | `0007_discovery_indexes`; `GET /projects`, `GET /users`, `GET /users/facets`; `GET /tags/cloud` with the cache; EXPLAIN recorded; migration proofs.                                                                                                                                            | 0007      |
| (c)  | `GET /me/dashboard`, `DashboardProject`, `DASHBOARD_*` config; X7; dashboard OpenAPI and `http/dashboard.http`.                                                                                                                                                                                | none      |
| then | `docs/m6-verification.md`: fresh clone, coverage, integration, matrix, p95, EXPLAIN, grep, real-token run, production check.                                                                                                                                                                   | none      |
| (d)  | Stretch, only on Levon's yes: `similar` endpoints.                                                                                                                                                                                                                                             | none      |

Each PR deploys on merge (the migrate job runs first). (a) and (c) carry no schema change,
so they cannot strand the previous revision. FE merges follow the "API merged and Deploy
green" rule; D4's FE half (forwarding the header) ships with FE PR (3) and is inert until
the Vercel variable exists.

## 12. Needs from other repos and from Levon

- **gradfolio:** the search page, browse pages, tag pages and dashboard (the FE plan);
  forward `x-forwarded-for` as `X-Client-IP` plus `X-Gradfolio-Proxy-Secret` on public
  server calls and send the token when logged in; remove `linkedinConnections` (D3),
  `profileViewed`/`projectUpdated` mock keys; tag route `/tags/[name]` calls
  `/v1/tags?name=`; types from `openapi.yaml` at the merged API commit.
- **gradfolio-sql:** nothing (the schema is owned here).
- **Levon:** D1–D6 above; the Secret Manager secret and the Vercel `API_PROXY_SECRET`
  (D4); the real-token run for the dashboard (queue row, same shape as M5-T1/M4-T2).

## 13. Out of scope

View counting (D2), similar items unless D2 says yes, autocomplete/suggest, typo
tolerance, language-specific stemming, synonyms (`ML` = `machine learning`), saved
searches, search analytics, a public activity feed, personalised ranking, caching of
search results (only the cloud is cached), changing `innodb_ft_min_token_size`.

## 14. Not verified in this plan

- **Cloud SQL restart duration** for option (b): not measured (no instance changed;
  `gcloud` was used read-only). The local restart took about 2 s on 20 MB.
- **IAM signing latency** for 20–40 images per page: not measured (no bucket locally).
- **Production behaviour of the forwarded header:** Vercel's overwrite is from its
  documentation, not observed from this machine; the FE PR's production run observes it.
- **The `MATCH … OR EXISTS` form at 30,000 rows** was measured on a seed whose duplicated
  rows have no terms (so the term probes are optimistic); 85 ms is a lower bound.
- **Armenian word-start `LIKE`** is covered by the unit and integration tests on a handful
  of names; no Armenian-language review of ranking quality.
- **The `db-f1-micro` instance's** FULLTEXT build time: measured on the local 8.4.11
  container only.
