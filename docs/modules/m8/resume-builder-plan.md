# M8: résumé Builder refactor — plan (Phase 1)

Status: **proposed, not approved**. No code written. Author: teammate chat (git email parg3v@gmail.com).
Related: tracker 8.9 and [M8-T28](tasks/M8-T28-cv-builder-plan.md) (product-level CV builder).

## 1. Ask

Levon: the PDF works, but it is hard to see how and what is inside; "put a builder in place".
Reading used here: **(A)** a code-level Builder — make generation understandable and extensible.
**(B)** the product CV builder (8.9) stays a separate, later decision. *To confirm with Levon/user:* is (A) what he meant?

## 2. Investigation (run on `main` @ f5b6a6e)

- `npx vitest run src/api/resume`: 6/6 pass (unit file only; integration `e2e/resume.int.test.ts` **not run**, needs MySQL — Docker left untouched).
- Flow: `POST /v1/me/resume` → `ResumeService.generate` → `snapshotResume` (repository: DB → `ResumeData`) → `renderResume` (PDFKit).
- `ResumeData` = `{name, headline, blocks:[{title, entries:[{title?, text, url?}]}]}` — already a template-neutral model. Good seam.
- `render-resume.ts` (77 lines) mixes four concerns in one function:
  1. limits (chars, pages, bytes, time) and `AppError RESUME_TOO_LARGE`;
  2. PDFKit setup (A4, margin 48, font, metadata, buffering to `Buffer`);
  3. layout: sizes/colours/spacing/page-break thresholds hardcoded inline (23/12/13/11/10/9 pt, `#14334a` etc.);
  4. content rules (url printed once as link if `text === url`).
- Repository assembles blocks with an `add(key, entries)` closure — the "builder" already half-exists there, implicitly.
- Only `resume.service.ts` and tests import `renderResume`. Small blast radius.
- Hidden-behaviour guards that tests pin and a refactor must keep: time budget checked before *and* after each text op; page cap via `pageAdded`; byte cap with `doc.destroy()`; URL de-dup; Armenian/Cyrillic/Latin glyphs.

## 3. Proposal (A): split into model → builder → renderer

```
snapshotResume (DB)  ──►  ResumeBuilder  ──►  ResumeData  ──►  PdfRenderer(template)  ──►  Buffer
                          .header(name,headline)               limits + PDFKit I/O
                          .section(key, title)                 Template = pure style table
                          .entry({title,text,url})
                          .build()
```

Files (feature module `src/api/resume/`, role folders per CLAUDE.md):

| File | Role |
| --- | --- |
| `utils/resume-builder.ts` | `ResumeBuilder`: fluent steps; skips empty sections (replaces repository `add` closure); enforces `resumeUrl` validation and the "url == text" rule in one place; `build(): ResumeData`. Pure, no I/O. |
| `utils/resume-data.ts` | keeps `ResumeData`, labels, `resumeUrl` (unchanged). |
| `templates/resume-template.ts` | `ResumeTemplate` interface = tokens only: page size, margin, fonts, per-role `{size,color}`, spacing, break thresholds. |
| `templates/classic.template.ts` | today's look, values lifted verbatim → **byte-for-byte same text/layout** as now. |
| `utils/render-resume.ts` | `renderResume(data, limits, template = classic)`: keeps limits + PDFKit lifecycle; layout reads the template instead of literals. Public signature stays compatible. |
| `repositories/resume.repository.ts` | uses `ResumeBuilder` instead of the closure. |

Not in this refactor: new endpoints, DB changes, new request fields, a second template exposed over HTTP (`template` is internal until (B) decides). Nothing new to document in `openapi.yaml`/`http/`.

Decision: **no `Renderer` interface for DOCX/HTML** (YAGNI at coursework scale). One renderer, swappable *template*. Revisit only if DOCX is chosen in (B).

### Why this answers "hard to understand"
Reader opens `resume-builder.ts` to see *what goes in* (sections/entries in order), `classic.template.ts` to see *how it looks*, `render-resume.ts` to see *limits and PDF plumbing*. Each file < ~80 lines.

## 4. (B) product CV builder — recommendation

Keep out of this PR. (A) is its prerequisite: saved CVs/per-CV order/templates all produce a `ResumeData` through the builder and pick a `ResumeTemplate`. T28 already recommends live-view-plus-overrides; (A) does not constrain that. Levon still decides v1.0 scope; this plan changes nothing in tracker 8.9 except noting (A) as a prerequisite slice.

Cheap (A+) option if Levon wants something visible: a second template (`compact`, single column, smaller type) selectable internally, and a **dev-only preview script** (`npm run resume:sample`) that renders a fixture to a file so people can see the output without a profile. Needs his OK; adds an npm script.

## 5. Claude Design role

Claude Design (design artifact / design system) is **not** a build dependency for the API. Use it for the *visual spec* of templates and, later, the (B) editor UI: it produces the look (type scale, colours, spacing, A4 mock) that a developer transcribes into a `ResumeTemplate` token table. Proposed order: (1) mock "classic" and one new template in Claude Design at A4, three scripts; (2) copy the numbers into template files. Unverified: whether the team has a Claude Design design system for Gradfolio; ask the user. PDFKit cannot import designs directly — transcription is manual.

## 6. Tests and proof (Phase 2/3 will do)

- Existing 6 unit tests pass unchanged (behaviour-preserving); add builder unit tests (empty section skipped, bad URL dropped, url==text de-dup, order).
- Golden check: render a fixed `ResumeData` before and after the refactor; extracted text and annotations identical (pdfjs, as the existing tests do).
- Prove each guard by removing it (time, pages, bytes) — existing tests must fail.
- `npm run verify`, `npm run test:coverage` (≥90%), `npm run test:int` incl. `resume.int.test.ts`; real run of `POST /v1/me/resume` and check the PDF — **needs Auth0 token; not available locally yet**, so Phase 3 real run depends on Levon's tenant details (or the test JWKS helper in the integration suite).
- Update `vitest.config.mts` coverage exclusions if paths move (`templates/` is new, `utils/` unchanged).

## 7. PR breakdown

1. This plan (docs PR, one review round, then merge).
2. Implementation PR: builder + template + renderer refactor + tests (single coherent chunk).
(A+) a third PR only if approved.

## 8. Open questions for Levon / user

1. Is (A) what "builder" meant, or should this task start (B)/T28?
2. Want the second template + sample-render script now (A+)?
3. Does a Claude Design design system for Gradfolio exist? Share the link.
4. Auth0 tenant details for the real-run phase.

## 9. Not verified

Integration test and real HTTP run; PDFKit version behaviour beyond the existing unit tests; any Claude Design capability (not opened).
