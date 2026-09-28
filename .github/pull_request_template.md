## What this changes

<!-- Behaviour, not a file list. Two to five lines. -->

## Why

<!-- The spec feature, plan section, tracker row or issue this serves. -->

## Evidence

- [ ] `npm run verify` passes
- [ ] `npm run test:coverage` stays at or above the threshold
- [ ] `npm run test:int` passes (needs `docker compose up -d mysql`)
- [ ] `/gradfolio-review` ran clean on the head commit (or the receipt's method is named below)

**Guards proved by removal.** List each check, guard or filter this PR adds, and the
test that fails when it is removed. For authorization, that is a second user getting
`404`.

| guard removed | test that failed |
| ------------- | ---------------- |
|               |                  |

<!-- Delete the table if the PR adds no guard. -->

**Real run** (for an HTTP, schema or database change): the requests sent against
`docker compose up -d --build`, and what they returned.

## Kept in step

- [ ] New or changed endpoint: `openapi.yaml` regenerated (`npm run openapi`)
- [ ] New or changed endpoint: request added to `http/<module>.http`
- [ ] Changes the frontend (`gradfolio`) or the schema (`gradfolio-sql`) need are listed below
- [ ] Commits split by logical change; tests are in the same commit as the code they test

## Not verified

<!-- What you could not check, and why. "Nothing" is a valid answer. -->
