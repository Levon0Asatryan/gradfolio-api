# M4 lead final report (2026-10-10)

Status: all code merged and live. Two logged-in production runs are pending on Levon, so M4 is not formally closed.

## Merged

- [api] #44 plan `bc45e4b`; #45 (a) contract and reads `d01c091`; #46 (b) writes and sanitizer `4092d3b`; #47 (c) attachments, uploads, signed reads `f595d59`; #48 replay-proof uploads, versioned sweep, signing never fails a write, bucket CORS `ff33005`; #49 docs/m4-verification.md; #51 roundtrip.mjs fixes `1f9c396`.
- [fe] #58 Codex follow-ups; #59 plan; #60 list and detail (DOMPurify, types); #61 form, edit, delete; #62 attachments editor and uploads; #63 Playwright smoke tests and CI; #64 production fix: 500 on every project page (jsdom 30 needs require(esm) under isomorphic-dompurify; pinned jsdom 26) and the attachment dialog submitting the project form; #65 e2e reproduces Vercel's no-require(esm) and a flaky test fix `be9df17`; #68 docs/fe-m4-verification.md `29bc35a`.

## Decisions (Levon)

- Q6 = Google Cloud Storage us-east1, private bucket, signed reads (300 s), about $0 per month.
- Editor = Tiptap. Playwright in the repo as its own PR.
- Sanitizer = sanitize-html 2.18.x on the API, DOMPurify on the FE.

## Review notes

- Copilot quota-failed on every M4 PR; only Codex reviewed.
- Merged before their Codex round landed: API #47 (2 P1, fixed in #48), API #49 (3 P2, fixed in #51), FE #63 (nothing found).

## Production state

- `STORAGE_BUCKET` set on Cloud Run revision gradfolio-api-00015-s4l (Levon ran it).
- Bucket `gradfolio-files-1058577031182`; CORS in `docker/gcs-cors.json` (PUT from gradfolio-navy.vercel.app and localhost:3010; headers Content-Type, x-goog-content-length-range, x-goog-if-generation-match).
- Roles: objectUser on the bucket and serviceAccountTokenCreator on gradfolio-api-run itself.
- `/readyz` 200.

## Pending (needs Levon's login)

1. [api] Real Auth0 token run (m4-verification §9) and production round trip with proof that library IAM signing works on Cloud Run (§10). Needs M4_TEST_TOKEN in gradfolio-api-m4/.env. Partial evidence: revision 00015 returned 201 on POST /v1/me/uploads.
2. [fe] Logged-in production run and looks matrix (fe-m4-verification §4 and §5): headed login as the test account. Second-account 404 skipped (covered by anonymous and unit tests only).
3. Levon has not acknowledged the 5-minute signed-URL window after a project turns private.

## Not verified

signBlob latency and quota; browser-level upload (CORS checked with curl and fetch only); previews cannot upload (no CORS wildcard); production holds no pre-M4 projects (assumed); WebKit and Firefox; attachment dialog focus return; FE keyboard tab order.

## Proposed tracker changes

- 4.1 to 4.10 done (PRs above). Q6 decided (GCS, private, signed reads). Q3 applies to projects via `projectVisibleTo`. Q5 types from openapi.yaml pinned at an API commit.
- Record the bucket, CORS file, IAM bindings, `STORAGE_BUCKET` on revision 00015, and the 5-minute signed-URL exposure window.
- Follow-ups:
  - schedule `storage:sweep` as a Cloud Run job;
  - M5 must register and sign team-member avatars, and tolerate deleted projects (`notifications.reference_id` has no FK);
  - retire `projects.files`, drop `projects.href`;
  - re-run `projects:resanitize` when the allow-list changes;
  - Dependabot and a corpus re-run on sanitize-html and @google-cloud/storage bumps;
  - previews cannot upload (no CORS wildcard);
  - FE newest/oldest now means creation date;
  - FE renders bare `<a>` (a rejected link) as text;
  - a patch to another field re-validates a stored description, which blocks edits if a limit is tightened later;
  - signed-out prefetch of protected sidebar links redirects into Auth0 and logs a console error (use `prefetch={false}` or answer 401);
  - the sanitizer's href check and `ALLOWED_URI_REGEXP` overlap (either alone is untested);
  - Playwright is now in the repo (tracker 9.6 groundwork);
  - previews hit the production API and database (known).
- Process: merge-before-review happened three times; Codex was the only reviewer.

## Machine (left up on purpose for the pending runs)

Docker project gradfolio-m4 (MySQL 3312), worktrees gradfolio-api-m4 and gradfolio-m4, scratchpad m4run (an earlier session's state.json is still there and must be deleted). The M5 stack gradfolio-m5 is not mine. Full cleanup happens after the two pending runs.

## Update 2026-10-10 (final)

Merged since: [api] #56 projectId optional on POST /v1/me/uploads (a435ac0, Deploy green). [fe] #70 image attach fix, root cause: FE host check accepted only <bucket>.storage.googleapis.com but the API signs path-style URLs (54d77d3); #73 create-time media editor and cover upload; #74 block Create/Save/Add while an upload is running, abort on unmount, pinned contract a435ac0 (befea8c); #76 no-login production run, 60 views (39875e6). #73 was merged before its two Codex findings were fixed; #74 fixed them. Levon tested an upload at creation by hand: works.
Findings (P3, open): F3 sidebar prefetch of protected links logs a CORS error on 59 of 60 signed-out views (use prefetch={false} or 401); F4 not-found pages shift layout 0.172 at 1440 (render without sidebar on first paint).
Still pending (Levon, queue in manual-testing.md): M4-T1 signed-URL window acknowledgement; M4-T2 API real-Auth0 token run + production round trip (m4-verification §9-§10); M4-T3 FE headed login for the logged-in looks matrix (fe-m4-verification §4, §5b). Not run; to be marked "not run by decision" if Levon skips.
Cleanup done: docker project gradfolio-m4 removed with its volume; worktrees gradfolio-api-m4 and gradfolio-m4 removed; local m4/* branches deleted in both repos (remote branches remain on GitHub); scratch and the stale browser session file deleted; no dev servers on 3006/3010; both sub-agents finished. Machine is clean for M4; M5 worktrees, branches and the orch-sync worktree are not mine and were left alone. For T2/T3 the agents recreate the local stack from a fresh worktree off main.
