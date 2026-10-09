# M4 verification

The final test record for M4 on the API side: tracker 4.1–4.5 and what FE tasks 4.6–4.10
needed from the API, [m4-plan.md](m4-plan.md). Unit, integration, clone, HTTP, storage and
guard runs on 2026-10-09 against MySQL 8.4.11 on `origin/main` at `ff33005` (after #48),
plus the bucket runs of 2026-10-08/09 against `gradfolio-files-1058577031182`. Two items need
a real Auth0 token and Levon's hands; they are marked **PENDING** with the exact steps
(§9, §10) and are filled in by the next commit of this PR.

No token, secret or email appears in this record. Local-tenant tokens were signed by the
test JWKS server. Every database run below started from an **empty volume**
(`docker-compose -p gradfolio-m4 down -v`), on this worktree's own project and port (MySQL
3312). Local runs use the standalone `docker-compose`.

## 1. Pull requests

| PR   | What                                                                    | Merge     | Reviews                                                                                                                                |
| ---- | ----------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| #44  | plan; Q6 = GCS, read access = S                                         | `bc45e4b` | 2 rounds + confirmation: 4 + 2 findings (bounded leak stated, upload cap counts objects, one registration per key, no `mailto`, tests) |
| #45  | (a) contract and reads                                                  | `d01c091` | round 1: 2 P2 (default page size above the max; `role` on summaries), both fixed                                                       |
| #46  | (b) writes and sanitizer                                                | `4092d3b` | round 1: 3 P2 (DATE range, resanitize counted a missed CAS, an empty-metadata test sent the wrong body), all fixed                     |
| #47  | (c) attachments, uploads, signed reads                                  | `f595d59` | merged before its Codex round; 3 findings landed after merge (replay, sweep race, signing after commit) and went to #48                |
| #48  | fix: replay-proof uploads, versioned sweep, signing never fails a write | `ff33005` | round 1: 1 P1 (bucket CORS had to name the new signed header), fixed and the bucket changed                                            |
| this | verification (docs, `scripts/roundtrip.mjs`)                            |           | requested; docs-only, merge does not wait                                                                                              |

Copilot failed on quota on every push (tracker, 2026-09-29); Codex reviewed alone.

| #   | Check                                                                    | Result                                                              |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1   | Fresh clone: `npm ci`, build, verify                                     | PASS (42 files, 811 tests)                                          |
| 2   | Coverage ≥ 90 %                                                          | PASS: statements 97.88, branches 95.94, functions 96.55, lines 98.8 |
| 3   | Integration against MySQL 8.4.11                                         | PASS (27 files, 454 tests)                                          |
| 4   | Migrations: none in M4; applied twice, second a no-op; types check       | PASS                                                                |
| 5   | OpenAPI: `openapi:check`; routes both ways                               | PASS (32 operations on 22 paths)                                    |
| 6   | Q3 on projects: owner / other / anonymous, detail + every list + profile | PASS (§3)                                                           |
| 7   | Second user: 404 on every write; anonymous 401; rows unchanged           | PASS (§4)                                                           |
| 8   | No private project in any public response (responses + log)              | PASS: 0 hits (§5)                                                   |
| 9   | XSS corpus (72 vectors) neutralized on write, through HTTP               | PASS (§6)                                                           |
| 10  | Concurrency forced with locks / barriers                                 | PASS (§7)                                                           |
| 11  | Real bucket: claim, replay, versioned delete, CORS, full flow            | PASS (§8)                                                           |
| 12  | Guard proofs (removal)                                                   | PASS (§11)                                                          |
| 13  | Real Auth0 token run                                                     | **PENDING** (§9)                                                    |
| 14  | Production round trip incl. library IAM signing on Cloud Run             | **PENDING** (§10)                                                   |
| 15  | Plan walk                                                                | PASS (§13)                                                          |
| 16  | Clean machine                                                            | see §15                                                             |

## 2. Fresh clone

`git clone <worktree> /tmp/m4-clone && git checkout ff33005` (cloned from the local
repository, never pushed first), then:

```
npm ci                       ok
npm run build                ok
npm run verify               format, lint, typecheck, openapi:check, unit: 42 files, 811 tests passed
npm run test:coverage        Statements 97.88 % (740/756)  Branches 95.94 % (473/493)
                             Functions 96.55 % (196/203)   Lines 98.8 % (659/667)
npm run test:int             27 files, 454 tests passed
npm run migrate (x2)         0001..0005 applied; second run: nothing to apply
npm run db:types:check       Generated types are up-to-date
npm run openapi:check        openapi.yaml: up to date
```

M4 added **no migration**; the five migrations above are M1–M3's. Every column M4 writes
existed (plan §6.4).

## 3–6. The built API over HTTP (Q3, second user, leak grep, XSS)

The built `dist` ran against the empty-volume database with a local JWKS tenant, a
`STORAGE_BUCKET`-less configuration (uploads answer 503; the storage paths are §8), three
users (owner; another; one with a private profile), a public, a private and a draft
project (each with a marker in every text field, a tag, a technology, a link, and four
attachment types), and the 72-vector corpus. Output of the script, unedited:

```
== Q3: who reads what (project detail)
PASS  public: anonymous 200, other 200, owner 200
PASS  private: anonymous 404, other 404, owner 200
PASS  private: body identical to an unknown id
PASS  draft: anonymous 404, other 404, owner 200
PASS  draft: body identical to an unknown id

== Q3: lists and profile
PASS  GET /users/:id/projects as anonymous: [public]
PASS  GET /users/:id/projects as other: [public]
PASS  GET /users/:id/projects as owner: [public]
PASS  GET /me/projects as owner: [draft,private,public]
PASS  GET /me/projects anonymous: 401
PASS  GET /users/:id (profile) projects as anonymous: [public]
PASS  GET /users/:id (profile) projects as other: [public]
PASS  GET /users/:id (profile) projects as owner: [draft,private,public]
PASS  private profile: list and profile 404 to anonymous
PASS  private profile: list and profile 404 to other
PASS  a public project of a private profile stays readable by id
PASS  anonymous filter q=LEAK-private: no private/draft marker
PASS  anonymous filter q=LEAK-draft: no private/draft marker
PASS  anonymous filter tag=LEAK-private-9c1e-tag: no private/draft marker
PASS  anonymous filter technology=LEAK-draft-9c1e-tech: no private/draft marker
PASS  anonymous filter category=other: no private/draft marker

== second user: 404 on every write, rows unchanged
PASS  public: PATCH/DELETE/attach add/patch/delete/order as another user -> 404,404,404,404,404,404; upload-sign -> 503 (this run has no bucket; the 404 for a foreign ...
PASS  public: rows (project, attachments, tags) unchanged
PASS  public: anonymous -> 401,401,401,401,401,401,401
PASS  private: PATCH/DELETE/attach add/patch/delete/order as another user -> 404,404,404,404,404,404; upload-sign -> 503 (this run has no bucket; the 404 for a foreign...
PASS  private: rows (project, attachments, tags) unchanged
PASS  private: anonymous -> 401,401,401,401,401,401,401
PASS  draft: PATCH/DELETE/attach add/patch/delete/order as another user -> 404,404,404,404,404,404; upload-sign -> 503 (this run has no bucket; the 404 for a foreign p...
PASS  draft: rows (project, attachments, tags) unchanged
PASS  draft: anonymous -> 401,401,401,401,401,401,401

== leak grep
PASS  private/draft markers in 16 anonymous/other-user responses: 0 hits
PASS  private fields and values in the same responses: 0 hits
PASS  API log (211 lines): no token, phone, birthday, email, sub

== XSS corpus through the API (72 vectors, create + patch)
PASS  72 vectors neutralized on create and patch (stored rows scanned)
PASS  every stored description is a fixpoint of the sanitizer

35 passed, 0 failed
```

What each line proves is in the matching section of the plan (§7 table). In words:

- **Q3 (§3):** the private and draft project answer 404 to anonymous and to another user
  with the body of an unknown id, and 200 to the owner. The owner's own list holds all
  three; `/users/:id/projects` and the profile's `projects` hold only the public one, for
  anonymous, another user and, on the public routes, the owner too. A private profile
  hides its list and its profile (404) and still lets its public project be read by id.
- **Second user (§4):** `PATCH`, `DELETE`, attachment add / change / delete / reorder
  answer 404 on a public, a private and a draft project, and the rows (project,
  attachments, tags) are byte-identical afterwards. The same calls with no token are 401.
  The upload-ticket 404 for a foreign `projectId` is asserted with storage on, in
  `files.int.test.ts` ("answers 404 for a project that is not the caller's, and signs
  nothing"); this run had no bucket (503).
- **Leak grep (§5):** the private and draft markers appear in none of the 16 anonymous
  and other-user responses (detail, lists, profile, and the filters `q`, `tag`,
  `technology`); none of `auth0Id`, `phone`, `birthday`, `email`, token fields, the
  phone/birthday/email/`sub` values; the API log holds no bearer token, phone,
  birthday, email or `sub` (211 lines; the `www-authenticate: Bearer` header name is the
  scheme, not a token, and is not counted).
- **XSS (§6):** 72 vectors through `POST` and `PATCH`; the stored rows hold none of
  `javascript:`, an event handler, `script`, `svg`, `img`, `iframe`, `style`, `math`,
  `object`, `embed`, `form`, `textarea`, `xmp`, `data:text`; and sanitizing a stored value
  again changes nothing. The same corpus also runs in the unit suite with a second parser,
  a re-parse fixpoint and execution in a scripting jsdom (`html.test.ts`, 154 tests).

## 7. Concurrency (forced, never a sleep)

Each test holds a lock on a second connection, waits with `waitForLockWaiters` until the
competing requests are provably queued, then releases it:

- two creates at cap − 1: one 201, one 409 (`project-writes.int.test.ts`)
- two replace-all tag lists: the final list is exactly one caller's
- a patch queued behind a delete: 404, not 500
- a create racing the account's deletion: 404, not a foreign-key 500
- two patches that are each valid alone but invert the date range together: one 200, one 400
- two attachment adds at the cap: one 201, one 409; a reorder racing an add: 409 `ORDER_STALE`
- two registrations of one file, both having read it as unclaimed before either claims:
  one 200, one 400 `FILE_IN_USE` (`files.int.test.ts`; the claim rule is the real
  bucket's, §8)
- replay of a signed upload URL after registration: 412 (fake enforces the signed header;
  the real bucket, §8)
- sweep: an object claimed or replaced between listing and delete is kept

## 8. Storage against the real bucket

Bucket `gradfolio-files-1058577031182` (`us-east1`, uniform access, public access prevention),
as the runtime service account `gradfolio-api-run` (impersonated by Levon's user through a
**temporary** `serviceAccountTokenCreator` binding that was added and removed for each run;
checked afterwards: no user binding remains, bucket empty). Only the URL signature itself came
from `gcloud storage sign-url` in the local runs; the library's own IAM signing is §10.

| Run                                                                                                                                                                                                                                                                                                                                                            | Result                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT with both signed headers / wrong content type / no range header / altered range / 19 bytes for `18,18`                                                                                                                                                                                                                                                     | 200 / 403 / 400 / 403 / 400                                                                                                                                                                                                                                                                                                                           |
| unauthenticated GET of the object; V4-signed GET; a PUT URL used for GET                                                                                                                                                                                                                                                                                       | 403; 200 with the right content type; 400                                                                                                                                                                                                                                                                                                             |
| two concurrent claims with the metageneration precondition; a stale claim                                                                                                                                                                                                                                                                                      | exactly one 200 and one 412; 412                                                                                                                                                                                                                                                                                                                      |
| adapter as the runtime account: `stat`, head read, `claim`, `list`, `delete` (twice)                                                                                                                                                                                                                                                                           | as designed; missing is `null`; double delete is not an error                                                                                                                                                                                                                                                                                         |
| **replay** of the signed PUT after the object exists, other bytes                                                                                                                                                                                                                                                                                              | **412**; generation and bytes unchanged                                                                                                                                                                                                                                                                                                               |
| claim with a wrong generation / the right version / again                                                                                                                                                                                                                                                                                                      | false / true / false                                                                                                                                                                                                                                                                                                                                  |
| delete with a stale version / with the listed version                                                                                                                                                                                                                                                                                                          | kept (false) / deleted (true)                                                                                                                                                                                                                                                                                                                         |
| full flow through the API: upload + replace avatar (old object gone; the replaced file cannot be registered again), hero, image, PDF, video, the same file twice (`FILE_IN_USE`), signed reads 200 with the right types and the unsigned URL 403, sweep dry run lists only the unregistered upload, attachment / project / account delete remove their objects | all as listed                                                                                                                                                                                                                                                                                                                                         |
| browser preflight (after #48's CORS change): production origin and `http://localhost:3010` with the three signed headers                                                                                                                                                                                                                                       | origin echoed, `allow-methods: PUT`, all three headers                                                                                                                                                                                                                                                                                                |
| same preflight from `https://evil.example`; with an unlisted header                                                                                                                                                                                                                                                                                            | no `access-control-allow-*`                                                                                                                                                                                                                                                                                                                           |
| `scripts/roundtrip.mjs` (FILES=1) against the real bucket through a local API                                                                                                                                                                                                                                                                                  | every step up to the signed-read check PASSed (uploads, replay 412, hero, PDF, reuse refused); the check then failed on my own case-sensitive header test (gcloud writes the parameter in lower case); fixed in the script; the signed-read, unsigned-403 and object-gone steps were not re-run through the script, they are the full-flow rows above |

CORS (exact, live; also `docker/gcs-cors.json`):

```json
[
  {
    "origin": ["https://gradfolio-navy.vercel.app", "http://localhost:3010"],
    "method": ["PUT"],
    "responseHeader": ["Content-Type", "x-goog-content-length-range", "x-goog-if-generation-match"],
    "maxAgeSeconds": 3600
  }
]
```

## 9. Real Auth0 token run — PENDING (needs Levon)

Goal: a project with every field and every attachment type is created, edited, reordered
and deleted with a **real** Auth0 access token against a local API on an empty volume, with
the stored rows checked. `scripts/roundtrip.mjs` does the HTTP part and prints no token.

Steps for Levon (about 5 minutes; the existing database-connection test user is fine):

1. In the `gradfolio` checkout, `.env.local` has `AUTH0_AUDIENCE=https://api.gradfolio.app`
   (as in [auth0-setup.md](auth0-setup.md) §7). `npm run dev -- -p 3010`.
2. Open `http://localhost:3010/auth/login`, sign in as the test user, then open
   `http://localhost:3010/auth/access-token` and copy the `token` value.
3. Put it in the gitignored `.env` of `gradfolio-api-m4` as `M4_TEST_TOKEN=eyJ…` (do not
   paste it into chat or a website). Check it locally without printing it:
   `node -e 'const p=JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url"));console.log(p.iss,p.aud)' "$M4_TEST_TOKEN"`.
4. Tell the orchestrator "token is in .env" (it lives 1 hour).

Then (me): `docker-compose -p gradfolio-m4 up -d` with the real issuer and audience;
run `API_URL=http://127.0.0.1:3006 TOKEN=$M4_TEST_TOKEN PAUSE=1 node scripts/roundtrip.mjs`.
`PAUSE=1` stops the script before its delete and prints the project id, because the script
deletes the project at the end and the rows can only be compared while it still exists.
While it waits, read the stored rows (`projects`, `project_attachments`, `project_tags`,
`project_technologies`, `terms`) and compare them with what the script sent (after its
edit: status `completed`, tags exactly `m4`, the professor cleared and the other three
metadata keys kept, four attachments in the reordered order), then press Enter so the script
deletes and checks the project is gone. Afterwards check the log for the token, `sub` and
email, and record the output here.

## 10. Production round trip and library IAM signing — PENDING (needs Levon)

`STORAGE_BUCKET` is set on revision `gradfolio-api-00015-s4l`. The library's own IAM
signing on Cloud Run is proved by `POST /v1/me/uploads` (a signed ticket, signed by the
library through `signBlob`), a `PUT` to it, and a read of the file through a signed read URL.
The Cloud Run request log already shows a `201` for `POST /v1/me/uploads` and `200`s for
project reads on that revision at 2026-10-09 13:47Z (made by the frontend's own checks, not
by this run), which says ticket signing works; the round trip proves the rest end to end.

Steps for Levon (a token for the **production** API: same tenant and audience; the live
site's login works):

1. Log in on `https://gradfolio-navy.vercel.app`, then get a token the way §9 does (local
   frontend against the same tenant) **or** ask me for the one-line snippet to read it from
   the browser session; keep it out of chat.
2. `export TOKEN=eyJ…` in a shell, then, from this repository:
   `API_URL=https://gradfolio-api-1058577031182.us-east1.run.app FILES=1 node scripts/roundtrip.mjs`
3. The script prints PASS/FAIL per step and **deletes what it created** (the project; its
   uploaded objects go with it). Expected last lines: the project gone, an old signed URL
   now 404, `round trip complete; nothing left behind`. The run creates only a project
   titled `m4-roundtrip-<time>`; it touches no profile field and no avatar.
4. Afterwards I check with `gcloud storage ls -r gs://gradfolio-files-1058577031182/`
   (sandboxed gcloud) that the bucket is empty and with the Cloud Run log that every call
   was 2xx/4xx as expected and nothing 5xx.

## 11. Guards proved by removal

Each row: the guard was removed (or weakened) and the named tests failed; then restored and
the suite re-run green. Two layers that back each other up (marked +) were removed together
because removing one alone changes nothing observable.

| PR  | Guard removed                                                                                                        | Failed                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| (a) | `projectVisibleTo` always true                                                                                       | 5: private/draft detail for anonymous and other; the leak test |
| (a) | published filter dropped from the user list; profile check dropped; owner scope dropped                              | 2; 1; 1                                                        |
| (a) | `id` tie-break; cursor on the value only; cursor sort check                                                          | 5; 5; 2 (the walk over 30 rows in one second, per sort)        |
| (a) | LIKE not escaped; query not strict; page max not enforced                                                            | 1; 2; 1                                                        |
| (a) | pending members shown; member-link visibility; owner avatar of a private profile; the video host list                | 1; 1; 1; 1                                                     |
| (a) | default page size above the max (config refine)                                                                      | 1                                                              |
| (b) | `user_id` out of delete; zero-row update/delete not 404                                                              | 1; 6 / 2                                                       |
| (b) | `user_id` out of the lock + update (+)                                                                               | 2                                                              |
| (b) | cap not checked; no user lock; patch not merged; no row lock; tags replace skipped                                   | 2; 2; 2; 1; 2                                                  |
| (b) | schema not strict; hero allows http; description measured before sanitizing; end-before-start; real-date; date range | 7; 3; 75; 3; 7; 2                                              |
| (b) | sanitizer: href check; textarea, svg kept; style attribute; event handlers; img allowed                              | 22; 2; 2; 5; 1; 22                                             |
| (b) | resanitize counts a missed CAS                                                                                       | 2                                                              |
| (c) | accept(): caller prefix; claimed check; type; size; magic number                                                     | 2; 3; 2; 1; 1                                                  |
| (c) | accept(): claim result ignored                                                                                       | 1 (two registrations at once)                                  |
| (c) | uploads: project ownership; cap off by one; size not signed                                                          | 1; 1; 1                                                        |
| (c) | objects not released: project, attachment delete, attachment replace, avatar replace, hero replace, account          | 2; 1; 1; 1; 1; 2                                               |
| (c) | link may point at an uploaded file                                                                                   | 1                                                              |
| (c) | attachment add / update / delete / reorder without the project lock                                                  | 2; 1; 1; 5                                                     |
| (c) | attachment lookup + delete not scoped to the project (+)                                                             | 1                                                              |
| (c) | reorder: foreign id not refused; stale set not refused; attachment cap                                               | 2; 3; 1                                                        |
| (c) | avatar / hero not registered; sweep age floor; referenced files not spared                                           | 7; 2; 1; 2                                                     |
| #48 | claim bound to metageneration only                                                                                   | 2 (replaced bytes)                                             |
| #48 | sweep deletes unconditionally; ignores the age floor                                                                 | 2; 2                                                           |
| #48 | a failed read signing fails the request; the create-only header dropped                                              | 1; 2                                                           |
| #48 | CORS file lacks a signed header; a header added to the signature                                                     | 1; 1 (`cors-config.test.ts`)                                   |
| fix | `roundtrip.mjs` against a local API whose PATCH replaces metadata; whose PATCH ignores the tags                      | script FAILs on the kept keys; FAILs on the tags               |

A defect found while proving guards (not in shipped code): a proof script restored a
half-mutated `attachment.repository.ts` (a missing project scope on the lookup); `tsc`
reported the unused parameter before the commit and it was fixed. The delete and update
scopes were intact, and another layer would have masked the missing one in tests: layered
guards were from then on removed together and the harness reads before it writes.

## 12. Sweep run plan (`storage:sweep`)

Orphans arise from uploads signed and PUT but never registered, a claim whose transaction
rolled back, and a delete that failed (logged as `storage object delete failed` with the key).

1. **Dry run, weekly and after any error burst:** `npm run storage:sweep` with
   `STORAGE_BUCKET` and `DATABASE_URL` set (a Cloud Run job from the API image running
   `node dist/core/storage/sweep-cli.js`, with the runtime service account, is the
   intended home; until it exists, from a shell with the sandboxed gcloud and the
   break-glass database path in [deploy.md](deploy.md)). It lists keys under `u/` that no
   `users.avatar_url`, `projects.hero_image_url` or `project_attachments.url / thumbnail_url`
   names and that are older than 24 h (`--hours N`).
2. **Read the list.** An orphan younger than the floor is never listed; one listed that the
   user still needs is a bug.
3. **Apply:** `npm run storage:sweep -- --apply`. It deletes each listed version only: an
   object claimed or replaced since the listing is kept and counted (`kept`). Safe to repeat.
4. **Alert signals:** `storage object delete failed`, `storage listing after account deletion failed`
   and `signing a read URL failed` in the log; a nonzero `kept` is normal under load.
5. Before M9: schedule it (Cloud Scheduler → job). Tracker row.

## 13. Plan walk

Every requirement sentence of the plan and the line that implements it (paths under `src/`).

| Plan sentence                                                                                    | Where                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| One predicate `projectVisibleTo` in the SQL of every read (§1, Q3)                               | `api/projects/utils/visibility.ts:26`; detail `repositories/project.repository.ts:59`; lists `:112`              |
| A private profile does not list its work; a public project stays readable by id (§5.2)           | `services/project.service.ts:7` (`findVisibleUser`)                                                              |
| Owner-only writes; a write that changes 0 rows answers 404 (§1)                                  | `services/project-write.service.ts:86–87`; `repositories/project-write.repository.ts` (`user_id` in every WHERE) |
| Create takes the user lock for the cap; patches take the project row lock (§1, §6.1)             | `project-write.service.ts:9`, `:57`; `project-write.repository.ts:87`                                            |
| Patch is merged and the whole result validated (§5.3)                                            | `project-write.service.ts:87` (`merge`)                                                                          |
| Strict bodies: server-owned keys and unknown keys are 400 (§5.4)                                 | `api/projects/dto/project-write.dto.ts:124` (+ attachment and upload DTOs)                                       |
| `description_html` sanitized on write, measured after, branded type the repository requires (§4) | `core/validation/html.ts:9`; `project-write.dto.ts:3`                                                            |
| Allow-list: tags, attributes, http(s) only, dropped-with-content elements (§4.1)                 | `html.ts:17` (`HREF`), `:81` (`nonTextTags`)                                                                     |
| Dates are real days within MySQL's range; end ≥ start (§5.4)                                     | `project-write.dto.ts:46`                                                                                        |
| Media URLs https only, no credentials (§1, §5.5)                                                 | `project-write.dto.ts:116`; `core/validation/http-url.ts`                                                        |
| Keyset paging on `(sort value, id)`; cursor for another sort is 400 (§6.3)                       | `api/projects/utils/cursor.ts:14`; `repositories/project.repository.ts:164,187`                                  |
| Attachments: project row lock is ownership and mutex; cap 409; reorder exact set (§5.2, §5.5)    | `services/attachment.service.ts:25,130`                                                                          |
| Video host on the parsed hostname; embed and thumbnail computed (§5.5)                           | `utils/video.ts:20`                                                                                              |
| A link never points at an uploaded file (only registered files are signed) (§3.6)                | `attachment.service.ts:203`                                                                                      |
| Upload: type and exact size and create-only precondition are signed; short life (§3.5, §3.7)     | `core/storage/gcs-file-storage.ts:33`; `core/storage/upload-headers.ts:12`                                       |
| Upload cap counts objects under the prefix; signing reserves nothing (§3.5)                      | `api/files/services/uploads.service.ts:79`                                                                       |
| Own rate budget for uploads (§3.5)                                                               | `api/files/uploads.controller.ts:15`                                                                             |
| Registering a file: caller prefix, exists, type/size, magic number, one claim ever (§3.5)        | `api/files/services/file-url.service.ts:85–107`                                                                  |
| Objects deleted after commit; a failed delete is logged and never fatal (§3.5)                   | `file-url.service.ts:159`; `project-write.service.ts` (`release` after the transaction)                          |
| Account deletion removes the whole user prefix (§3.5)                                            | `file-url.service.ts:180`; `api/me/services/account.service.ts:57`                                               |
| A read URL that cannot be signed never fails a committed write (§3.7)                            | `file-url.service.ts:135`                                                                                        |
| Avatar and hero are registered on write (§3.5)                                                   | `api/profiles/services/profile.service.ts:99`; `project-write.service.ts:66`                                     |
| The sweep deletes only the listed version (§3.7)                                                 | `core/storage/sweep.ts:64`                                                                                       |
| Every endpoint in `openapi.yaml`, has a request in `http/`, has a second-user 404 test           | `openapi.yaml` (32 operations); `http/projects.http`; `project-writes`, `attachments`, `files` int tests         |
| Bucket CORS names every signed header (§3.7)                                                     | `docker/gcs-cors.json`; `core/storage/cors-config.test.ts`                                                       |
| No migration (§6.4)                                                                              | `core/db/migrations/` unchanged since 0005                                                                       |

Deviations from the plan's text, all recorded in the plan and its PRs: `category` is
top-level in project responses; a rejected link stays a bare `<a>` (sanitize-html closes the
next link with the wrong tag if the tag is renamed away); registration runs inside the write's
transaction; team-member avatars are not signed (M5 must register them).

## 14. Defects found

- **Sanitizer:** renaming a rejected link away made `sanitize-html` close the next good link
  with `</span>`. Found by the first real run of (b); fixed, regression test.
- **Signed upload replay** (post-merge review of #47): fixed in #48, run against the real
  bucket.
- **Sweep race, signing failure after commit** (same review): fixed in #48.
- **Bucket CORS missing the new signed header** (review of #48): fixed in the bucket and in
  `docker/gcs-cors.json`, with a drift test.
- **Not an API defect, for the frontend:** at 2026-10-09 13:52Z two `POST /v1/projects`
  returned 201 on revision 00015, and the Cloud Run log shows no `GET /v1/projects/<id>` after
  them and no 5xx; the 500 Levon saw on `…/projects/<id>?flash=created` therefore comes from
  the Next.js page before it calls the API.

## 15. Not verified

- The two PENDING items (§9, §10).
- `signBlob` latency and quota under load; the 5-minute window after a project turns private
  (a bounded leak, plan §2.2) is design, not tested against a browser, and **Levon has not
  acknowledged it**.
- Production holds no projects from before M4 (assumed; the seed is local).
- Copilot never reviewed any M4 push (quota); only Codex did.
- Preview deployments cannot upload (bucket CORS has no wildcard origin).
- Browser-level behaviour of the upload flow (the preflight was run with curl, and the PUT
  with Node's `fetch`, not from a real page).

## 16. Machine

Containers: `gradfolio-m4-mysql-1` (and `-api-1`) are left up for the pending runs and are
removed with `docker-compose -p gradfolio-m4 down -v` after §9. `/tmp/m4-clone` and the
scratch scripts are removed at the end. No `serviceAccountTokenCreator` binding for a user
remains; the bucket is empty.
