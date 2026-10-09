# M4 plan: projects and media

Tracker tasks 4.1–4.5, and what FE tasks 4.6–4.10 need from the API. Decides **Q6**
(file storage, Levon's call) and applies **Q3 = A** to projects. Product calls for
Levon: **Q6** (§2.1), **read access to files** (§2.2). **Both decided 2026-10-08:
Q6 = GCS `us-east1`; read access = S (private bucket, signed GET URLs).** The bucket
exists and the probe has run (§3).

Claims marked **run** were executed on 2026-10-08 against MySQL **8.4.11** (compose
project `gradfolio-m4`, port 3312), Node 24.20, Kysely 0.29, mysql2 3.24.5, zod 4.6.5,
sanitize-html 2.18.0, dompurify 3.4.16, jsdom 30.1.2, @google-cloud/storage 8.3.0.
Probe scripts ran outside the repo; their behaviour is re-proved by tests in the PRs
(§7). Frontend facts were read from `gradfolio@cb48095` (`origin/main`), read-only.
Prices and docs were fetched on the same day (links inline). The bucket probe ran on
2026-10-08 after Levon's OK (§3.3).

## 1. Decisions

| ID           | Decision                                                                                                                                                                                                                                                                                 | Evidence |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Q3 (project) | One predicate, `projectVisibleTo(viewer)`: `(is_public = 1 AND is_draft = 0) OR user_id = viewer`, in the SQL of every read. A private or draft project answers 404 to everyone but its owner and is excluded from every list.                                                           | §5.2     |
| Q6           | **Decided (Levon, 2026-10-08): Google Cloud Storage `us-east1`, same project, private bucket, signed read URLs (§2.2 = S).**                                                                                                                                                             | §2, §3   |
| Sanitizer    | **`sanitize-html`** (pinned 2.18.x) with a strict allow-list, on every write of `description_html`. The FE re-sanitizes with DOMPurify (4.8): two different parsers.                                                                                                                     | §4       |
| Write lock   | Project writes first take the project row `SELECT … WHERE id = ? AND user_id = ? FOR UPDATE` (no row: 404). Creates take `lockUser` (the M3 helper) for the per-user cap. Order: user row, project row, child rows, `terms`.                                                             | §6.1     |
| Migration    | **None.** Every column M4 needs exists (0001, 0004). No existing row can break a new rule: nothing writes projects today except the seed.                                                                                                                                                | §6.4     |
| Media URLs   | Media URLs (hero, attachments of type image/video/pdf) are **https only**. Other project URLs (demo, repo, links, files) stay http(s), as in M1.                                                                                                                                         | §5.5     |
| Pagination   | Keyset cursor `(sort value, id)`, not offset. `created_at` is `DATETIME` (whole seconds), so ties are common; the `id` tie-break keeps pages stable while rows are added.                                                                                                                | §6.3     |
| Limits       | Config, not literals: `PROJECT_MAX_PER_USER` (100), `PROJECT_MAX_ATTACHMENTS` (20), `PROJECT_MAX_TAGS` (20), `PROJECT_MAX_TECHNOLOGIES` (30), `PROJECT_MAX_LINKS` (10), `PROJECT_DESCRIPTION_MAX_BYTES` (100000), `PROJECTS_PAGE_SIZE` (20, max 50).                                     | §5.4     |
| Orphans      | A storage key is claimed once, ever (§3.5), so the object is deleted after the row's transaction commits without a race; a failed delete is logged with the key. A sweep script (`storage:sweep`) lists objects with no row and deletes those older than 24 h. No bucket lifecycle rule. | §3.5     |

## 2. Questions for Levon

### 2.1 Q6: where do files live?

Needs: avatar, hero image, attachments (image, PDF). Sizes: image ≤ 5 MB, PDF ≤ 20 MB
(config). Scale: tens of users, hundreds of projects. Assumed worst plausible month: 100
users, 3 GB stored, 5 000 uploads, 100 000 downloads, 20 GB egress.

| Option                               | Price (fetched 2026-10-08)                                                                                                                                                                                                                                                                                                                                                                                                                       | Fit                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. GCS, `us-east1`** (recommended) | [pricing](https://cloud.google.com/storage/pricing): Standard $0.020/GB-month; Class A $0.005 per 1 000 ops; Class B about $0.0004 per 1 000 (a search snippet read $0.004; I used the higher number below); egress free up to 100 GB/month (Always Free); 5 GB-months free. **Month: about $0** (3 GB inside the free 5; ops $0.03 + $0.40 worst case; egress inside 100 GB). Trial credit covers it anyway. Signing through IAM costs nothing. | Same project, same IAM, **no key file and no static secret** (Cloud Run's service account signs). Size and type limits enforced by the signature (§3.1). The API owns the flow end to end, so Q11 holds. Cost: one IAM binding, one CORS file, a 17 MB dependency.                                                                                                                                                                                     |
| B. Vercel Blob                       | [pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing): Hobby free (1 GB, 10 000 simple ops, 2 000 advanced ops, 10 GB transfer), **hard stop when exceeded** ("you will not be able to access Vercel Blob"); Pro: storage $0.023/GB, advanced ops $5/M, transfer $0.05/GB. **Month: $0 on Hobby** within 1 GB.                                                                                                                        | Lives beside the FE. Client uploads need a token minted **in Next.js**, so the API (Cloud Run) does not control size, type or ownership; it would have to trust the FE or hold `BLOB_READ_WRITE_TOKEN` to verify and delete. Server uploads hit the [4.5 MB body limit](https://vercel.com/docs/vercel-blob/server-upload). Private blobs are delivered through a Function that streams them. Two vendors hold user data. Hobby's 1 GB is the ceiling. |
| C. Cloudflare R2                     | [pricing](https://developers.cloudflare.com/r2/pricing/): $0.015/GB-month; Class A $4.50/M, Class B $0.36/M; free 10 GB, 1 M A, 10 M B; **egress free**. **Month: $0.**                                                                                                                                                                                                                                                                          | Cheapest and free egress. A new vendor and account, and a **static S3 access key** (stored in Secret Manager, to rotate). Size limit by signature is not established here (S3 presigned PUT can sign an exact `Content-Length`; presigned POST policies, which carry a range, are not on R2 as far as I know; **not run**). Nothing in the project's IAM covers it.                                                                                    |
| D. URL-only for v1                   | $0.                                                                                                                                                                                                                                                                                                                                                                                                                                              | No upload code, no CORS, no bucket. Avatars and heroes hot-link third-party hosts; links die; `evidence` (spec §4) is not stored by us. 4.5 moves to stretch. The URL columns and validators already exist, so this stays available as a fallback.                                                                                                                                                                                                     |

**Recommendation: A.** It keeps the secret surface at zero (the one thing this project
has avoided: no key files), keeps the upload rules in the API where they are tested,
and costs nothing at this scale. D is the cheapest to ship; choose it if the bucket
setup is not worth it before the deadline. Pick B only if the FE team wants everything
on Vercel and accepts the ceiling and the trust shift.

Expected monthly cost for A, worst plausible month: storage 3 GB (free) + Class A 5 000 ×
$0.005/1000 = **$0.03** + Class B 100 000 × $0.004/1000 (the pessimistic price) =
**$0.40** + egress 20 GB (free) = **under $0.50**; **$0** in a normal month. Bucket
creation itself is free. The existing budget alert ($10) is untouched.

**Decided: A (Levon, 2026-10-08).** The bucket and the two IAM bindings were created
with the sandboxed gcloud only (§3.2); no key file, nothing else billed.

### 2.2 Who can read a private project's files?

With Q3 = A a private project is 404 to everyone else. Files are bytes at a URL, so:

| Option                                                | What happens                                                                                                                                                                                                                                                                                                                                                                             | Against                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S. Private bucket, signed read URLs** (recommended) | Public access prevention on. The DB stores the canonical object URL; every project response swaps it for a V4 `GET` URL valid `FILE_READ_URL_TTL_S` = **300 s** (cached in memory 240 s per key, so a URL is stable while cached). A private project's files cannot be fetched without a response that only its owner receives, and a URL already issued stops working within 5 minutes. | One IAM `signBlob` call per uncached object; URLs change every 4 min (the FE already renders with `unoptimized`, so no image-cache loss). IAM Credentials `signBlob` has a per-project quota I did not look up; the cache keeps calls to new objects only. |
| P. Public-read bucket, unguessable keys               | `allUsers: objectViewer`. Keys are `u/<userId>/<uuid>.<ext>` (122 random bits). No signing on read.                                                                                                                                                                                                                                                                                      | A URL that was ever visible keeps working after the project turns private, and after delete if the object delete fails. That is Q3's rejected "unlisted" model for files.                                                                                  |

**Decided: S (Levon, 2026-10-08).** The avatar of a private profile follows the same rule.

**What S does not give (stated plainly).** A signed URL is a bearer credential and
cannot be revoked. If a public project turns private, a non-owner who loaded it in the
last `FILE_READ_URL_TTL_S` keeps a working file URL until it expires: **a bounded leak of
at most 5 minutes** (the TTL is the only knob; the cache window is shorter than it).
Anyone who saved the bytes keeps them under any model. Nothing issues a new URL once the
project is private (the predicate is in the SQL). Rotating the object on every
visibility change, or proxying every read through the API, would close the window and was
rejected: a proxy cannot serve `<img src>` without a token (Q11), and rotation rewrites
rows and objects on a toggle. This needs Levon's acknowledgement; the cost of a 5-minute
TTL is that a page left open longer than that shows broken images until it reloads
(the FE refetches on navigation).

## 3. Storage design (applies to option A)

### 3.1 Findings, by running

| #   | Run                                                                                                                                                                                             | Result                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Sandboxed gcloud (`CLOUDSDK_CONFIG` verified = `/Users/levon/Dev/university/.sandbox/gcloud`). `gcloud storage buckets list`.                                                                   | 0 buckets. `iamcredentials.googleapis.com` and `storage.googleapis.com` are already enabled.                                                                                                                                                                                                                                                                                                                                                        |
| G2  | `gcloud iam service-accounts sign-blob … --iam-account=gradfolio-api-run@…` as Levon (project **Owner**).                                                                                       | **`IAM_PERMISSION_DENIED`, permission `iam.serviceAccounts.signBlob`.** Even Owner cannot sign. `roles/iam.serviceAccountTokenCreator` is the predefined role that holds it (`iam.serviceAccounts.signBlob`, `signJwt`, `getAccessToken`, …, listed by `gcloud iam roles describe`). `gradfolio-api-run` has only `roles/cloudsql.client` on the project and no binding on itself.                                                                  |
| G3  | `@google-cloud/storage` 8.3.0 `getSignedUrl({version:'v4', action:'write', contentType:'image/png', extensionHeaders:{'x-goog-content-length-range':'1,5242880'}})` with a throwaway local key. | URL on `<bucket>.storage.googleapis.com/<key>`; `X-Goog-SignedHeaders=content-type;host;x-goog-content-length-range`, `X-Goog-Expires=300`. So the type and the size range are **inside the signature**; a PUT that omits or changes either header does not match it. Without a key the library signs through IAM `signBlob` as the runtime service account (library behaviour per its docs; **not run**, it needs G2's binding).                   |
| G4  | Docs ([signing](https://docs.cloud.google.com/storage/docs/access-control/signing-urls-manually), [headers](https://docs.cloud.google.com/storage/docs/xml-api/reference-headers)).             | V4 expiry ≤ 7 days. `x-goog-content-length-range: MIN,MAX` inclusive, body outside it gives **400**. The client must send the header as signed.                                                                                                                                                                                                                                                                                                     |
| G5  | [CORS docs](https://docs.cloud.google.com/storage/docs/using-cors).                                                                                                                             | JSON `[{origin, method, responseHeader, maxAgeSeconds}]`, set with `gcloud storage buckets update gs://B --cors-file=…`. `origin` is exact (or `*`); **no `*.vercel.app` wildcard**, so a Vercel preview origin must be listed by hand or cannot upload. The fetched page was ambiguous on whether `responseHeader` must name the request headers (`Content-Type`, `x-goog-content-length-range`); I will list both, and the probe in §3.3 decides. |

### 3.2 What was created (2026-10-08, sandboxed gcloud)

`CLOUDSDK_CONFIG` checked: `gcloud info` printed
`/Users/levon/Dev/university/.sandbox/gcloud`. Project
`project-33e407b5-7fd5-485d-8dc`. No key file exists or was created.

```sh
gcloud storage buckets create gs://gradfolio-files-1058577031182 \
  --location=us-east1 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://gradfolio-files-1058577031182 --cors-file=cors.json
gcloud storage buckets add-iam-policy-binding gs://gradfolio-files-1058577031182 \
  --member=serviceAccount:gradfolio-api-run@project-33e407b5-7fd5-485d-8dc.iam.gserviceaccount.com \
  --role=roles/storage.objectUser
gcloud iam service-accounts add-iam-policy-binding \
  gradfolio-api-run@project-33e407b5-7fd5-485d-8dc.iam.gserviceaccount.com \
  --member=serviceAccount:gradfolio-api-run@project-33e407b5-7fd5-485d-8dc.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator
```

`cors.json`: origins `https://gradfolio-navy.vercel.app` and `http://localhost:3010`;
method `PUT`; `responseHeader` `Content-Type`, `x-goog-content-length-range`;
`maxAgeSeconds` 3600. `describe` shows `US-EAST1`, uniform access, public access
prevention enforced. Bucket IAM: the runtime account `objectUser` (plus the project's
legacy owner/editor/viewer roles that GCS adds); no `allUsers`. The account's own policy:
the runtime account `serviceAccountTokenCreator` (on itself, not the project) and the
existing deployer `serviceAccountUser`. `serviceAccountTokenCreator` is wider than a
custom `signBlob`-only role (it also allows `getAccessToken` for that one account);
with one runtime account and no key files the predefined role is accepted.

To run the probe as the runtime account I added a **temporary**
`serviceAccountTokenCreator` binding for Levon's user on that account, used
`gcloud storage sign-url --impersonate-service-account` (the same IAM `signBlob` path
Cloud Run uses), then **removed it** (verified: the policy above is what remains).
Still to do: `STORAGE_BUCKET` on the Cloud Run service via `deploy.yml` (PR (c)).

### 3.3 Probe results (run 2026-10-08, real bucket, signed as the runtime account)

Signed with `sign-url --http-verb=PUT --headers content-type=image/png,x-goog-content-length-range=18,18`
(an 18-byte PNG-headed body), 5 min expiry, then `curl`:

| Request                                                                                                                              | Result                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| PUT with both signed headers, 18-byte body                                                                                           | **200**                                                                                                                          |
| PUT with `Content-Type: text/html` (signed `image/png`)                                                                              | **403** (signature mismatch)                                                                                                     |
| PUT without `x-goog-content-length-range`                                                                                            | **400**                                                                                                                          |
| PUT with `x-goog-content-length-range: 0,999999` (signed `18,18`)                                                                    | **403**                                                                                                                          |
| PUT with a 19-byte body and the signed `18,18`                                                                                       | **400** (range enforced)                                                                                                         |
| unauthenticated `GET` of the uploaded object                                                                                         | **403** (public access prevention)                                                                                               |
| `GET` with a V4 signed URL (1 h)                                                                                                     | **200**, `content-type: image/png`                                                                                               |
| the PUT-signed URL used for `GET`                                                                                                    | 400 (a URL is bound to its verb)                                                                                                 |
| Preflight `OPTIONS` (`PUT`, `content-type, x-goog-content-length-range`) from the production origin and from `http://localhost:3010` | 200, `access-control-allow-origin` = the origin, `allow-methods: PUT`, `allow-headers: Content-Type,x-goog-content-length-range` |
| Preflight from `https://evil.example`                                                                                                | 200 with **no** `access-control-allow-*` headers (the browser blocks it)                                                         |

Both headers are listed in `responseHeader`; I did not test with them omitted, so keep
both. `sign-url` needed `--region=us-east1` (it could not infer it from the name). The
probe object was deleted (`gcloud storage rm -r gs://…/probe`); the bucket is empty. Not
measured: `signBlob` latency under load and its quota (one call per uncached object,
cached 240 s). A signed `PUT` URL can be replayed with the same headers until it
expires (it overwrites the same key); the key is fixed per URL and under the caller's
prefix, so it can only overwrite the caller's own object.

### 3.4 Q11: the token never reaches the browser (shown)

```
browser ──(form: type, size)──▶ Next.js server action
Next.js server ──Bearer token──▶ POST /v1/me/uploads   (API checks ownership, limits, rate)
API ──signBlob (IAM, runtime account)──▶ signed PUT URL, headers, fileUrl
Next.js server ──▶ browser: {uploadUrl, headers, fileUrl}          (no token in it)
browser ──PUT bytes + the signed headers──▶ storage.googleapis.com (the URL is the credential)
Next.js server ──Bearer token──▶ PATCH/POST write with fileUrl     (API verifies the object)
```

The browser holds one short-lived (5 min), single-object, single-method URL pinned to
one content type and one exact size. It never holds an Auth0 token, and the API still
needs no CORS (the CORS rule is on the bucket). The alternative, streaming the bytes
through Next.js, fails on Vercel's 4.5 MB request limit for any image over that size.
Q11 is not weakened: the FE calls the API only from the server.

### 3.5 Flow and rules (4.5)

- **`POST /v1/me/uploads`** `{purpose: 'avatar'|'hero'|'attachment', contentType, size, projectId?}`.
  `hero` and `attachment` need `projectId`, owned by the caller (else 404). Allowed types:
  images `image/png|jpeg|webp|gif` (≤ `UPLOAD_MAX_IMAGE_BYTES`, 5 MB), `application/pdf`
  (≤ `UPLOAD_MAX_PDF_BYTES`, 20 MB). Anything else, or a size over the limit: 400. No
  SVG, no HTML.
- Key `u/<userId>/<uuid>.<ext>`, extension chosen by the server from the type. The
  signature pins `Content-Type` and `x-goog-content-length-range: <size>,<size>` (exact
  declared size), expiry 5 min (`UPLOAD_URL_TTL_S`). Own budget `@RateBudget('upload')`
  (`RATE_LIMIT_UPLOAD`, default 20/min).
- **Upload cap counts objects, not rows** (a row count misses signed URLs never
  registered). At sign time the API lists the objects under `u/<userId>/`
  (`maxResults = UPLOAD_MAX_FILES_PER_USER + 1`, default cap 200) and answers 409
  `LIMIT_REACHED` at the cap, else signs. **Signing reserves nothing**: it changes neither
  the bucket nor the database, so no lock or transaction would make the cap exact, and
  none is used (the sign route only checks the project's owner). Abandoned uploads count
  until the sweep deletes them. The bound is therefore cap + the URLs signed but not yet
  used: at most `RATE_LIMIT_UPLOAD` × `UPLOAD_URL_TTL_S` / `RATE_LIMIT_WINDOW_S` = 100
  (default 20/min × 300 s / 60 s), so **at most 300 objects per user** with the defaults.
  A reservation table (exact bound) was rejected as more machinery than a coursework
  bucket needs. The test checks exactly this: 199 objects → a sign succeeds and the
  count is still 199; 200 → 409; the bound arithmetic is asserted from the config values.
- **Register on write.** A write that carries a URL inside our bucket (`avatarUrl`,
  `heroImageUrl`, attachment `url`) goes through `FileUrlService.accept()`: the key must
  start with `u/<callerId>/` (else 400 `INVALID_FILE`, not 404: it is a body field),
  the object must exist (`getMetadata`), its stored size and content type must be within
  the allow-list for the field (an `image` attachment must be an image), and for images
  and PDFs the first bytes are read with a range request and checked against the magic
  number. Failure: 400, nothing written. Any other https URL passes as before (URL-only
  stays valid for links, videos and external images).
- **One key, one registration (the claim).** `accept()` ends by _claiming_ the object:
  `setMetadata({claimed: '<rowKind>'})` with `ifMetagenerationMatch` set to the
  metageneration it just read. The first registration wins; a second request for the same
  key, concurrent (412) or later (metadata already set), is 400 `FILE_IN_USE`. A key is
  therefore registered **at most once, ever**, even after its row releases it: clearing or
  replacing a reference can delete the object without any race against a re-registration,
  because a re-registration of that key can no longer succeed. This replaces both the
  "no other row references it" check and a post-commit re-check (which left a window).
  Re-saving an unchanged value on the same row does not call `accept()` (the stored URL is
  compared first). If the transaction rolls back after the claim, the object stays claimed
  and unreferenced: unusable, swept after 24 h; the user uploads again. To reuse a file the
  user uploads it again. One extra metadata write (Class A) per registration.
- **Delete.** Replacing or clearing a hero/avatar/attachment, deleting an attachment, a
  project (cascade) or the account (`DELETE /v1/me`, M3 deferred this to M4) collects the
  caller's object keys inside the transaction (`SELECT` before the `DELETE`), and deletes
  the objects after commit. Safe by the claim: no row can come to reference a deleted key
  afterwards. A failed delete is logged (`storage object delete failed`, key) and is not
  an error for the caller. Account deletion lists the prefix `u/<userId>/` instead, which
  also catches uploads never registered.
- **Orphans** (signed but never registered; delete that failed): `npm run storage:sweep`
  lists the bucket, subtracts the keys referenced by rows, deletes unreferenced objects
  older than 24 h (`--dry-run` default). Run by hand, or later as a Cloud Run job. Not a
  bucket lifecycle rule: a lifecycle rule cannot tell referenced from unreferenced.
- **Serving.** Content types are fixed at upload (pinned in the signature), so a `.png`
  is served as `image/png` from `storage.googleapis.com`, a different origin from the
  app. Reads per §2.2 (S).

If Levon picks D, §3.4–3.5 and `UploadsController` are dropped; `FileUrlService.accept()`
becomes "any https URL".

## 4. Sanitizer (4.2): measured

Corpus: 62 vectors in `corpus.mjs` (scratch; it becomes `sanitize.corpus.ts` in PR (b)),
grouped as: script (3), event handlers (8), SVG (4), MathML (2), URL schemes (16:
`javascript:`, case, decimal/hex entities with and without `;`, tab/newline/control/space
inside or before the scheme, `&colon;`, `vbscript:`, `data:`, protocol-relative, ZWSP),
embeds (6: iframe, `srcdoc`, object, embed, base, meta refresh, link), forms (2), style
(7: `expression()`, `url(javascript:)`, `position:fixed`, `@import`, class injection, DOM
clobbering), mutation XSS (12: SVG/MathML `<style>` breakouts, `mglyph`, `noscript`, form
nesting, `textarea`, `xmp`, comments, CDATA, `template`, `select`, `listing`), nesting,
tabnabbing. Plus five benign documents (headings, lists, quote, code block, links,
Armenian/Russian/CJK/emoji text) that must survive. The advisory PoCs below join the
corpus in PR (b).

How a result is judged (run): the output is **re-parsed by a second parser** (jsdom/parse5)
and rejected if it holds any element or attribute outside the allow-list, any `href` not
`http(s)`, or any class outside `language-*`; the HTML must be a **fixpoint of
serialise-then-parse** (the mutation-XSS check); it is **executed** in a scripting jsdom
(`runScripts: 'dangerously'`) and must not call `alert`; and `sanitize(sanitize(x)) ===
sanitize(x)`.

| Measure                              | `sanitize-html` 2.18.0                                                                                                                                             | DOMPurify 3.4.16 + jsdom 30.1.2                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Out-of-the-box allow-list, first run | 60/62 neutral (the two it missed: relative `href` and ZWSP scheme survived as "relative URLs"); 14 non-idempotent (my `transformTags` ran before the scheme check) | 61/62 (the `class` attribute allowed everywhere let `class="MuiBackdrop-root"` through) |
| After the fixes below                | **62/62**, 0 idempotence breaks, 5/5 benign                                                                                                                        | **62/62**, 0 idempotence breaks, 5/5 benign                                             |
| 160 kB document                      | 9 ms                                                                                                                                                               | 93–163 ms                                                                               |
| Small document                       | 0.01 ms                                                                                                                                                            | 0.1–0.2 ms                                                                              |
| Import time, resident memory         | 45 ms, 62 MB                                                                                                                                                       | 768 ms, 139 MB (Cloud Run is 512 MiB, min 1)                                            |
| `node_modules` for it alone          | 4.1 MB                                                                                                                                                             | 26 MB                                                                                   |
| Parser                               | htmlparser2 (not a browser parser)                                                                                                                                 | parse5 DOM (the spec parser)                                                            |

The fixes were in my config, not the libraries: validate `href` with one strict regex
(`^https?://` and no whitespace, control or zero-width characters) inside the
tag transform, and give `class` only to `<code>` with `^language-[a-z0-9+#-]{1,20}$`.

**Advisories (GitHub Advisory API, fetched today).** `sanitize-html` has had a run of
bypasses this year: mutation XSS through `</textarea/>` (GHSA-jxwj-j7wr-gfrw, ≤ 2.17.5),
SVG SMIL URI list (GHSA-g8qq-57p8-ggw5, ≤ 2.17.6), incomplete scheme validation
(GHSA-vccv-cmxp-4j9h, ≤ 2.17.4), `xmp` raw-text passthrough, critical, 2.17.3
(GHSA-rpr9-rxv7-x643), entity-decoded text in non-text tags (GHSA-9mrh-v2v3-xpfm). All are
fixed in 2.18.0, and every one is in elements the allow-list below never lists
(`textarea`, `xmp`, `svg`, `style`, `noscript`). DOMPurify's 2026 advisories are almost
all `IN_PLACE`, hooks, `CUSTOM_ELEMENT_HANDLING` or `SAFE_FOR_TEMPLATES`, modes this plan
does not use; the one default-mode XSS (GHSA-87xg-pxx2-7hvx) was 3.4.4 only.

**Pick: `sanitize-html`.** Equal on the corpus; 10× faster; 77 MB less memory and no
second DOM implementation in a 512 MiB container; no jsdom to patch. The honest weakness
is its non-browser parser, which is where its mutation-XSS advisories come from. The
mitigations: (1) the allow-list excludes every element class those advisories involve;
(2) the post-condition test above (fixpoint) runs on the whole corpus; (3) the FE
re-sanitizes with **DOMPurify, a different engine** (4.8), so one parser's bug is not
the other's; (4) Dependabot already tracks the package. The choice would flip to
DOMPurify only if the corpus found a bypass that DOMPurify stops.

### 4.1 Allow-list (to agree with the FE plan)

- **Tags:** `h2 h3 h4 p br strong em u s code pre blockquote ul ol li a hr`. Legacy
  `b`→`strong`, `i`→`em`, `h1`→`h2`, `h5 h6`→`h4`; any other tag is removed and its text
  kept; `script`, `style`, `textarea`, `xmp`, `noscript`, `template`, `svg`, `math`,
  `iframe`, `object`, `embed`, `form`, `input`, `button`, `select`, `img` and their
  contents are dropped entirely (`nonTextTags`).
- **Attributes:** `a[href rel target]` and `code[class]`. Nothing else: no `style`, `id`,
  `name`, `class` elsewhere, `data-*`, `aria-*`, event handlers. Every link is rewritten
  to `rel="noopener noreferrer nofollow" target="_blank"`; a link whose `href` fails the
  regex keeps its text as a bare `<a>` with no attributes (PR (b) deviation: renaming it to
  drop the tag made sanitize-html close the next link with `</span>`, found by a real run).
- **Schemes:** `https`, `http` only, as AGENTS.md requires for any stored user URL. No
  `mailto:`, protocol-relative, relative, `data:`, `javascript:`, `tel:`. (The measured
  corpus run above also allowed `mailto:`; the implementation and the corpus drop it, and
  a `mailto:` vector is added as a must-be-unwrapped case.)
- **No images and no tables** in v1. Images belong to attachments. **The FE editor must
  not offer an image or table button**, must limit headings to H2–H4, and may emit
  `<pre><code class="language-x">`. Tiptap's StarterKit output (`p`, `h2`–`h4`, `strong`,
  `em`, `s`, `code`, `pre>code`, `blockquote`, `ul/ol/li`, `hr`, `br`, `a`) plus
  `underline` fits exactly. A change to this list is a PR here and a one-off re-sanitize
  of stored rows (script in PR (b); the output is idempotent, so running it twice is safe).
- **Size:** `descriptionHtml` is measured **after** sanitizing against
  `PROJECT_DESCRIPTION_MAX_BYTES` (100 000), well under `API_BODY_LIMIT` (256 kB).
  Sanitization is on write only; reads return the stored value.

## 5. Contract

### 5.1 FE types vs. columns (the mismatches)

Read from `gradfolio@cb48095`: `src/data/project.mock.ts`, `src/components/project-new/*`,
`src/app/projects/[id]/page.tsx`, `src/components/project/*`, `projects/*`,
`src/components/dashboard/RecentProjects.tsx`, `src/utils/types/dashboard.types.ts`,
`src/data/locales/en.ts`.

| Frontend                                                                                                | Column / API                                                                                                | Mismatch and handling                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id: "ecoroute"` (slug), `attachments[].id` from `Math.random()`                                        | UUIDs generated by the server                                                                               | Routes use UUIDs. The FE drops client ids and uses the ones in responses.                                                                                                                                                                                                                                                                   |
| `aiSummary` (the form field labelled "AI Summary"; shown on cards and as the page subtitle)             | `summary` is the user's text; `ai_summary` is for M8's generated text                                       | **Name and meaning.** The form's field is the user's `summary`. API returns `summary` and `aiSummary` (nullable, read-only until M8). FE shows `summary ?? aiSummary`, relabels the field "Summary" (i18n). The dashboard's `description` is also `summary`.                                                                                |
| `title`, `heroImageUrl?`, `descriptionHtml`, `liveDemoUrl?`, `links?`, `files?`, `technologies`         | `title`, `hero_image_url`, `description_html`, `live_demo_url`, `links`, `files`, `project_technologies`    | `?` ↔ `null`; arrays never null. `links`/`files` are `{label,url}[]` JSON (M1 `linkList`). `files` overlaps attachments of type `pdf`: both stay writable, FE form uses attachments only (follow-up: retire `files`).                                                                                                                       |
| `repo{url, latestCommitDate?, readmeUrl?}`; form `repoUrl`                                              | `repo_url`, `repo_latest_commit`, `repo_readme_url` (+ `repo_stars/forks/language`, `github_repo_id`, 0004) | Manual writes accept `repoUrl` only (http(s)). Commit date, readme URL, stars, forks, language and `source` are **read-only**; GitHub import (M7) fills them. Response: `repo{url,latestCommitDate,readmeUrl,stars,forks,language}`, all nullable.                                                                                          |
| `metadata{startDate?, endDate?, category?, course?, professor?}`                                        | `meta_start_date`, `meta_end_date` (DATE), `category` (ENUM), `meta_course`, `meta_professor`               | Response: `metadata{startDate,endDate,course,professor}`; `category` is **top-level**, as on `ProfileProject` (the FE maps it into its own `metadata`; changed from the first draft of this plan in PR (a)). Dates are `YYYY-MM-DD` strings (the pool returns DATE as text; run in M1). `endDate ≥ startDate` or 400. `null` end = ongoing. |
| `category`: `course personal research hackathon academic other` (`PROJECT_CATEGORIES`)                  | ENUM `academic personal research hackathon course other`                                                    | **Identical sets (6 = 6).** No mapping. The 4-value type in `profile.mock.ts` is stale (profile cards already receive six from M3). Unknown value: 400.                                                                                                                                                                                     |
| dashboard `status: "ongoing" \| "completed" \| "archived"`                                              | ENUM `status` same three                                                                                    | Identical. The form has no status field (4.6 adds it).                                                                                                                                                                                                                                                                                      |
| Form has no `isPublic`; no draft concept                                                                | `is_public` (default 1), `is_draft` (0004, default 0)                                                       | API: `isPublic` writable; `isDraft` writable (`false` = publish). GitHub imports start as drafts (M7). A draft is owner-only like a private project. Default for a new manual project: public, published (the schema default).                                                                                                              |
| `attachments[].thumbnailUrl` — the form sets a random unsplash URL for videos (`source.unsplash.com`)   | `thumbnail_url`                                                                                             | **The FE must not send it.** The API computes it: YouTube `https://img.youtube.com/vi/<id>/hqdefault.jpg`; Vimeo none; an uploaded image uses its own URL.                                                                                                                                                                                  |
| Video: FE builds the iframe by `url.replace("watch?v=","embed/")`, only for `youtube.com\|youtu.be`     | `url` (the user's link)                                                                                     | `youtu.be/<id>` and `watch?v=…&t=` do not embed with that replace. API returns **`embedUrl`** for allow-listed hosts (`https://www.youtube-nocookie.com/embed/<id>`, `https://player.vimeo.com/video/<id>`), id checked by regex. FE iframes `embedUrl` only. A video on another host is rejected (400) in v1.                              |
| `team[]{id,name,role?,avatarUrl?,profileUrl?}`                                                          | `project_team_members` (M5; Q4)                                                                             | Read-only in M4: accepted members as `team[]{id,name,role,avatarUrl,userId}`; `userId` is null when their profile is not visible to the caller (Q3), so the FE shows no link. **No team writes before M5.** The owner is `owner{id,name,avatarUrl}` (avatar null when the owner's profile is private).                                      |
| Projects list sorts by **start date** (`newest`/`oldest`), name A–Z/Z–A; search by title and technology | `created_at` etc.                                                                                           | API `sort`: `newest`, `oldest` (by `created_at`), `updated`, `name_asc`, `name_desc`. FE values already match except `newest`/`oldest` meaning (start date → creation date); say so in the FE plan. `q` (title or technology contains, `LIKE`-escaped, ≤ 100 chars) is supported on the own list; full search is M6.                        |
| Profile card `Project.href`, `tags`                                                                     | `projects.href` (TEXT, unused); `project_tags`                                                              | `href` is not exposed; the route is `/projects/:id`. Follow-up: drop the column. Tags and technologies are two lists (both in M1's registry); the form edits both.                                                                                                                                                                          |
| `next.config.ts` image hosts: `i.pravatar.cc`, `images.unsplash.com` (mock)                             | storage host                                                                                                | 4.9: hostname `gradfolio-files-1058577031182.storage.googleapis.com` (the bucket's virtual host, which is what signed URLs use); mock hosts removed.                                                                                                                                                                                        |
| Dates shown with `formatDay` (UTC)                                                                      | `createdAt`, `updatedAt` as ISO 8601 UTC                                                                    | Matches.                                                                                                                                                                                                                                                                                                                                    |

### 5.2 Endpoints

All under `/v1`, all in `OPERATIONS`, all in `http/projects.http`, all rate-limited per
route (default budget, plus `upload` where marked). Errors: 400 `VALIDATION_FAILED`, 401,
404 `NOT_FOUND`, 409 (`LIMIT_REACHED`, `ORDER_STALE`), 429, 503.

| Method | Path                               | Auth     | Result                                                                                                                                                                                                                           |
| ------ | ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/projects/:id`                    | optional | `ProjectDetail`. 404 if missing **or not visible to the caller**; the same body for both.                                                                                                                                        |
| GET    | `/me/projects`                     | token    | `{items: ProjectSummary[], nextCursor}`; own projects in every state; filters `state=published\|private\|draft`, `category`, `status`, `tag`, `technology`, `q`; `sort`; `limit`, `cursor`.                                      |
| GET    | `/users/:id/projects`              | optional | The same page shape; that user's public, published projects only (even for the owner: the owner uses `/me/projects`). 404 if the user's **profile** is not visible to the caller (M3's `visibleTo`). Same filters minus `state`. |
| POST   | `/projects`                        | token    | 201 `ProjectDetail`; 409 `LIMIT_REACHED` at `PROJECT_MAX_PER_USER`. Body: every field of §5.1 that is writable; `title` required.                                                                                                |
| PATCH  | `/projects/:id`                    | token    | Partial (strict), merged with the stored row and validated whole; returns `ProjectDetail`; 404 if not the caller's.                                                                                                              |
| DELETE | `/projects/:id`                    | token    | 204; 404 if not the caller's. Cascades children; objects deleted after commit (§3.5).                                                                                                                                            |
| POST   | `/projects/:id/attachments`        | token    | 201 attachment, placed **last** (`MAX(sort_order) + 1`); 409 at `PROJECT_MAX_ATTACHMENTS`.                                                                                                                                       |
| PATCH  | `/projects/:id/attachments/:attId` | token    | `title` and/or `url` (re-validated for its type; the type is fixed); returns the attachment.                                                                                                                                     |
| DELETE | `/projects/:id/attachments/:attId` | token    | 204.                                                                                                                                                                                                                             |
| PUT    | `/projects/:id/attachments/order`  | token    | Body `{ids}`: exactly the project's attachment ids; returns the list in the new order.                                                                                                                                           |
| POST   | `/me/uploads`                      | token    | Signed `PUT` (§3.5). Own budget `upload`. Absent if Levon picks D.                                                                                                                                                               |

`GET /me` and `GET /users/:id` (the profile) keep their contracts. `ProfileProject`
(`id, title, summary, category, status, heroImageUrl, tags, role, isPublic, isDraft`) is
unchanged in shape; `heroImageUrl` is signed when option S is chosen. The owner-only
`state`/`isDraft` already in M3 stays. A projects mutation changes nothing in
`ProfileProject`'s fields, so no version bump; any later change is additive.

`ProjectSummary` = the `ProfileProject` fields plus `summary`, `technologies`,
`metadata.startDate/endDate`, `createdAt`, `updatedAt`, `isOwner`. `ProjectDetail` =
summary fields + `descriptionHtml`, `aiSummary`, `liveDemoUrl`, `repo`, `metadata`,
`links`, `files`, `attachments[]{id,type,url,title,thumbnailUrl,embedUrl}`, `team[]`,
`owner`, `source`. Never in any response: `auth0Id`, `email`, `phone`, `birthday`, any
integration column; `github_repo_id` stays internal.

### 5.3 Read path and Q3

`SELECT <explicit columns> FROM projects WHERE id = ? AND projectVisibleTo(viewer)`;
children (attachments, tags, technologies, team) are read only after that row exists.
Lists put the predicate in the same statement as the filters. A private project never
leaves the database for a caller who may not see it. A team member who is not the owner
sees public projects only (Q4 is M5). The author line of a public project of a private
profile shows the name (as team rows already do) and no avatar.

### 5.4 Write validation

`title` required, trimmed, `columnString('projects.title')`; `summary` nullable text;
`descriptionHtml` nullable, sanitized then measured; `category`, `status` enums;
`isPublic`, `isDraft` booleans; `liveDemoUrl`, `repoUrl` `httpUrl`; `heroImageUrl`
`httpsUrl` (or our object, §3.5); `metadata.course/professor` `columnString`;
`technologies` ≤ 30 and `tags` ≤ 20 through `termList` and `setProjectTerms`
(canonical spelling; replace-all); `links`/`files` `linkList` (≤ 10), written only via
`toJsonColumn`. Request schemas are `strictObject`: `id`, `userId`, `source`, `repo*`
metadata, `createdAt`, `aiSummary` and unknown keys are 400 (mass assignment). Limits are
read from config and checked inside the lock.

### 5.5 Attachments (4.3)

| `type`  | Rule                                                                                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image` | `httpsUrl`; our object or an external https image. Thumbnail = the URL.                                                                                                                                                                                                                                                               |
| `video` | `httpsUrl` whose host is in `ATTACHMENT_VIDEO_HOSTS` (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`, `vimeo.com`, `player.vimeo.com`; config). The id is parsed (`[\w-]{11}` YouTube, digits Vimeo); no id, 400. Host match is on the parsed hostname, never a substring. `embedUrl` and `thumbnailUrl` are computed. |
| `pdf`   | `httpsUrl`; our object (type and magic number checked) or any external https URL (the link is not fetched, SSRF-free).                                                                                                                                                                                                                |
| `link`  | `httpsUrl`.                                                                                                                                                                                                                                                                                                                           |

`title` ≤ 500. Credentials in a URL (`https://user:pw@…`) are rejected. The server never
fetches an attachment URL except our own bucket objects.

## 6. Investigation (runs)

### 6.1 MySQL 8.4.11 (P1–P5)

| #   | Run                                                                                                                                                                                                                                                                    | Result                                                                                                                                                                                                                                          | Decision / test                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Atomic attachment reorder: transaction A holds `projects … FOR UPDATE` + the project's attachments `FOR UPDATE` and runs one `UPDATE … SET sort_order = CASE id … END WHERE project_id = ? AND id IN (…)`; transaction B (add attachment) takes the same project lock. | B **queued** (`performance_schema.data_lock_waits` polled until a waiter existed, no sleep); A updated 3 of 3 rows; after commit B inserted at `-1`: order `new:-1, c:0, a:1, b:2`.                                                             | Reorder = lock project row, lock the attachment ids, compare the set, one `CASE` UPDATE, matched = n else throw. Reuse M3's `applyOrder` generalised to an owner column. Test: add blocked by a barrier while reorder holds the lock. |
| P2  | The same `UPDATE` with an attachment id of **another project** in the list, scoped by the wrong `project_id`.                                                                                                                                                          | 0 rows matched.                                                                                                                                                                                                                                 | The `WHERE project_id = ?` is the guard; removing it is the proof. Foreign id → 404.                                                                                                                                                  |
| P3  | Replace-all tags on a project with none, two concurrent transactions (`DELETE` the empty range, register terms, `INSERT`), **no project lock**.                                                                                                                        | One got **`ER_LOCK_DEADLOCK` (1213)**; the survivor's list was kept.                                                                                                                                                                            | Same as M3's P5.                                                                                                                                                                                                                      |
| P4  | The same with `SELECT … FROM projects WHERE id = ? FOR UPDATE` first in both.                                                                                                                                                                                          | Both `ok`; the final list is exactly the second caller's, never a mix.                                                                                                                                                                          | Project lock + `inTransaction` (retries 1213 from the `terms` upserts). Test under a barrier.                                                                                                                                         |
| P5  | Delete a project that has attachments, team rows, tags, technologies; delete a user who has a project with attachments.                                                                                                                                                | All four child tables → 0 rows (FKs `ON DELETE CASCADE`, read from `information_schema`); user delete cascades through projects to attachments (1 → 0). **`notifications.reference_id` has no FK**: rows naming a deleted project would remain. | Cascades already correct; no migration. Collect object keys **before** the delete. Notifications referencing projects are written by M5: it must clean up or tolerate a missing target (tracker row).                                 |

M3's runs P1 (same-value `UPDATE` matches 1), P3/P4 (stale set without the lock), P7
(delete vs create) carry over: `numUpdatedRows` is the matched count, so "0 rows → 404"
never fires on a no-op edit, and `lockUser` throws NotFound when the account vanished.

### 6.2 Code this touches

`AccessTokenGuard`/`@OptionalAuth()` (M3) for the two public reads. `SectionService` and
`ordered-section.repository.ts` are written for `user_id`-owned sections; attachments are
`project_id`-owned, so the helpers take the table, owner column and lock query as
parameters (PR (c)), not a copy. `setProjectTerms` exists (M1). `RATE_BUDGETS` gains
`upload`; `RATE_LIMIT_UPLOAD` in the schema. `COLUMN_LIMITS` already covers every project
column. `types.generated.ts` unchanged (no migration). `API_BODY_LIMIT` (256 kB) stays: the
description is capped at 100 kB, and uploads never pass through the API.

### 6.3 Pagination

`created_at` and `updated_at` are `DATETIME` (run: type `datetime`), second resolution.
Offset pages shift when a row is added between requests, and ties on the sort value make
`LIMIT/OFFSET` order undefined without a tie-break. Keyset: `ORDER BY <v>, id`; cursor =
base64url JSON `{s: sort, v: lastValue, id: lastId}`; a cursor made for another `sort`, a
malformed one, or one with an unknown key is 400. Next page: `(v, id) > (?, ?)` (row
constructor comparison; `<` for descending). `limit` + 1 rows read to know whether there
is a next page. Name sorts use `title` under the table collation (case-insensitive).
Test: 30 projects created in one second, paged by 7 in each sort while a row is inserted
mid-walk, every id seen exactly once.

### 6.4 Migration need: none

Every column M4 writes exists: `projects` (0001 + 0004 `is_draft`, `source`, repo
fields), `project_attachments`, `project_tags`/`project_technologies` (0003), the JSON
CHECKs (0002). Storage keys are derived from the stored URL (one parser, one
`STORAGE_BUCKET` check), so no `storage_key` column. Indexes: `idx_projects_user` serves
every list (hundreds of rows per user at most). Existing rows: no endpoint writes
projects today, and the seed is local, so production should hold none; **not verified**
(no break-glass job was run). If there are any, the audit before PR (b) is
`SELECT COUNT(*) FROM projects` plus the new validators run over them in a script; rows
that fail stay readable and fail only when edited. If a later decision needs a column
(for example a per-user byte quota), it is additive, applied twice in CI, down then up
identical, safe against the previous revision, per the M4 rules.

## 7. Security properties and how each is proved

Every proof is a test **seen failing** with the guard removed (recorded in
`m4-verification.md`).

| Property                                                                                                                               | Test                                                                                                                                                                                                                                                                                                | Guard removed                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Q3: private and draft project = 404 to other user and anonymous, 200 to the owner; same body as a missing id                           | e2e matrix owner / other / anonymous × public / private / draft on detail, `/users/:id/projects`, `/me/projects`, profile `projects`                                                                                                                                                                | drop `projectVisibleTo` from each SQL (separately)            |
| No private project in any public response                                                                                              | seed private/draft rows with a unique marker in title, summary, description, tag, attachment; scan every JSON string of every read as anonymous and other user; plus grep of the logs                                                                                                               | add the marker row to a list query without the predicate      |
| Second user: 404 on every write (`PATCH`/`DELETE` project, attachment POST/PATCH/DELETE/order, upload sign with a foreign `projectId`) | e2e per route; nothing changed in the rows                                                                                                                                                                                                                                                          | remove `user_id` from each `WHERE` / project lock query       |
| Same-value `PATCH` is 200, not 404                                                                                                     | e2e                                                                                                                                                                                                                                                                                                 | n/a (guards against a wrong fix of the above)                 |
| Mass assignment: `id userId source repo* aiSummary createdAt` rejected                                                                 | e2e, each key → 400, row unchanged                                                                                                                                                                                                                                                                  | make the schema non-strict                                    |
| XSS corpus neutralized on write; stored output idempotent                                                                              | 62 vectors + advisory PoCs through `POST` and `PATCH`; re-parse in a second parser; fixpoint; execute in scripting jsdom; stored value equals re-sanitize of itself                                                                                                                                 | remove a tag from the exclusion list; drop the href regex     |
| No write path skips the sanitizer                                                                                                      | test that lists every route writing `description_html` (create, patch) and a unit test on the repository: it accepts only a branded `SanitizedHtml`                                                                                                                                                 | pass raw HTML to the repository                               |
| URL schemes: `javascript:`, `data:`, `vbscript:`, credentials, non-https media rejected on every URL field                             | table test through each endpoint                                                                                                                                                                                                                                                                    | swap `httpsUrl` for `z.string()`                              |
| Video host allow-list is on the parsed hostname                                                                                        | `youtube.com.evil.example`, `evil.example/youtube.com`, `youtube.com@evil.example`, userinfo, punycode lookalike → 400                                                                                                                                                                              | substring match                                               |
| Attachment reorder takes exactly the project's set; atomic                                                                             | stale set (add under barrier) → 409; foreign id → 404; mid-way failure (injected statement) rolls back                                                                                                                                                                                              | drop the set check; drop the lock                             |
| Tags/technologies replace-all serialized                                                                                               | barrier on the project lock wait: final list is exactly one caller's; a failing insert keeps the old list                                                                                                                                                                                           | drop the transaction; drop the lock                           |
| Create and attachment caps hold under concurrency                                                                                      | two creates at cap − 1 behind a barrier: one 201, one 409; same for attachments                                                                                                                                                                                                                     | drop the lock                                                 |
| Delete vs. create/attach: no 500                                                                                                       | barrier                                                                                                                                                                                                                                                                                             | drop `lockUser`'s not-found / project row lock                |
| Cascades; keys collected before delete; objects deleted after commit                                                                   | integration over every child table; fake storage records deletes: none before commit, all after; failed delete is logged and does not fail the request                                                                                                                                              | delete before commit; swallow without a log                   |
| Upload: type/size outside the allow-list refused; key under the caller's prefix; the signature pins type and exact size                | unit on the signing parameters (signed headers include `content-type` and `x-goog-content-length-range: n,n`); `accept()` rejects another user's key, a missing object, wrong size/type/magic number                                                                                                | take the prefix check out; drop the header from the signature |
| Pagination stable and cursor validated                                                                                                 | the walk in §6.3; cursor from another sort / forged key → 400                                                                                                                                                                                                                                       | drop the `id` tie-break                                       |
| Every new route rate-limited, per route; `upload` budget separate                                                                      | parameterized e2e with `RATE_LIMIT_DEFAULT=2`: third call 429; exhausting one route leaves another at 200; upload exhausted leaves default at 200                                                                                                                                                   | mark a route `@SkipThrottle`; share a budget                  |
| Contract is the code                                                                                                                   | `document.test.ts` (routes both ways), `$ref`s resolve, bodies/params present, `openapi:check`                                                                                                                                                                                                      | n/a                                                           |
| A key registers once, ever; delete after commit is race-free                                                                           | e2e with fake storage that implements `ifMetagenerationMatch`: two concurrent writes with one `fileUrl` → one 200, one 400 `FILE_IN_USE`; clear a reference (object deleted), then write the same URL → 400 (object gone / claimed); a rolled-back write leaves the object claimed and unreferenced | drop the claim; claim without the precondition                |
| Upload cap counts objects; signing reserves nothing                                                                                    | fake storage with 199 objects incl. unregistered: a sign succeeds and the listing still has 199; at 200 → 409; abandoned objects count; after `storage:sweep` a sign succeeds; the cap + 100 bound is computed from config in the test                                                              | count rows instead of objects                                 |
| Storage against real GCS                                                                                                               | the probe in §3.3 and the real-token run (§8)                                                                                                                                                                                                                                                       | n/a                                                           |

Race tests use a barrier (`waitForLockWaiters`), never a sleep. Storage in tests is a fake
behind a `FileStorage` interface (the only code that imports `@google-cloud/storage`);
the real client is exercised by the probe and the real run.

## 8. Pull requests

1. **This plan** (docs only; one review round, then merge). **Stop: Levon decides Q6
   (§2.1), file read access (§2.2), and says yes or no to the bucket and the IAM change.**
2. **(a) Contract and reads.** `projectVisibleTo`; `GET /projects/:id`, `GET
/me/projects`, `GET /users/:id/projects` (keyset cursor); `ProjectSummary`/`Detail`
   schemas with `.meta({id})`; `http/projects.http`; config for limits and page size;
   seed gains a public, a private and a draft project with attachments. FE can start:
   types, list and detail. No writes yet (a documented operation must be served).
3. **(b) Writes and sanitizer.** `POST/PATCH/DELETE /projects`, tags/technologies/links,
   `sanitize-html` + corpus + re-sanitize script, the concurrency tests.
4. **(c) Attachments and storage.** Attachment routes (generalised reorder),
   `FileStorage` + `FileUrlService`, `POST /me/uploads`, `accept()`, deletes after
   commit, account deletion deleting objects, `storage:sweep`, `deploy.yml`/`deploy.md`
   changes for `STORAGE_BUCKET`, FE image host note. The bucket and IAM exist (§3.2).
5. `docs/m4-verification.md` in the last PR: fresh clone; verify, coverage ≥ 90 %,
   integration; second-user matrix; Q3 for owner/other/anonymous on the project, every
   list and the profile; the grep that no private project leaks; the XSS corpus; barrier
   tests; a real Auth0 token creating a project with every field and attachment type,
   editing, reordering, deleting, with stored rows and storage objects checked; on
   production after deploy: `/readyz` 200 and one create/delete round trip with Levon's
   token; OpenAPI check; plan walk; guard proofs; CI; clean machine.

Reviews: both reviewers on every push; Copilot quota failures accepted (Codex alone).
**Merge order:** an FE PR that calls a new endpoint merges only after the API PR has
merged **and** Deploy on `main` is green (`/readyz` 200).

## 9. Out of scope

Search and browse (M6; will reuse `projectVisibleTo`). Team writes and invitations (Q4,
M5). GitHub import (M7; `isDraft`/`source`/`repo*` columns are read-only here). AI
summary (M8; `aiSummary` stays null). SVG, video upload, image resizing or thumbnails
(`next/image` is `unoptimized`). Virus scanning. Per-user byte quota (count-based cap
only). Dropping `projects.href` and retiring `files`. A bucket lifecycle rule. Breaking-
change linting (oasdiff).

## 10. Notes for the FE plan (not for this repo to change)

- Editor: H2–H4, no image, no table; output fits §4.1. Disable the editor's own link
  `target`/`rel` options (the API sets them); keep DOMPurify with `ALLOWED_URI_REGEXP`
  `^https?:` as the second layer (no `mailto:`).
- Form fields and limits to mirror: §5.4; relabel "AI Summary" to Summary; do not send
  `thumbnailUrl` or ids; send `null` to clear.
- Upload from a server action: `POST /me/uploads` → browser `PUT` with the returned
  headers **exactly** → write with `fileUrl`. Previews cannot upload unless their origin
  is in the bucket CORS (§3.1 G5).
- Delete: confirmation names the project; a second user's id answers 404 → show not-found.
- Use `embedUrl` for videos; render `metadata.category` through the existing chip.
- Bump the pinned API commit (Q5) after PR (a) is live.

## 11. Proposed tracker changes (for the orchestrator)

- Q6: decided GCS `us-east1`, private bucket, signed reads (2026-10-08); cost about
  $0/month, under $0.50 worst case. Bucket `gradfolio-files-1058577031182` and the two
  IAM bindings exist; `STORAGE_BUCKET` still to be set on the service. Q3: record "applies to projects: `projectVisibleTo`".
- 4.1–4.5: PR split (a)/(b)/(c); 4.2 = `sanitize-html` 2.18.x (decided in this plan).
- New rows: **IAM `serviceAccountTokenCreator` on `gradfolio-api-run` is required for
  signed URLs (Owner is denied `signBlob`, run)**; bucket CORS has no `*.vercel.app`
  wildcard (previews cannot upload); `notifications.reference_id` has no FK (M5 must
  tolerate or clean deleted projects); retire `projects.files` and drop `projects.href`;
  re-sanitize script when the allow-list changes; `storage:sweep` as a scheduled job;
  `sanitize-html` and `@google-cloud/storage` under Dependabot, with a note to re-run
  the corpus on each `sanitize-html` bump.
- Follow-up: FE `newest`/`oldest` on `/projects` now means creation date, not start date.
