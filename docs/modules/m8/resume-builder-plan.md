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

A second template and a sample-render script were considered and **declined** (user, 2026-11-02).

## 5. Claude Design role

Found in the docs: the Claude Design prototype Levon approved on 2026-10-05
(https://claude.ai/artifact/XR1nnxZ2niPcyDBADdDgFU, the UI acceptance spec, tracker "UI track"),
and its code form in the frontend: `gradfolio/src/components/theme/tokens.ts`, written up in
`gradfolio/docs/ui-plan.md` (palette C calm; Nunito + Noto Sans Armenian; contrast asserted by
`tokens.test.ts`). The artifact has no résumé/PDF screen (read 2026-11-02; its page shows only
preview controls), so the frontend tokens file is the source to copy from.

Role in this refactor:

- `ResumeTemplate` names its colour tokens after the design system's roles (`text`,
  `textSecondary`, `primary`, `secondary`) instead of the current anonymous hex values, and
  `classic.template.ts` notes the matching `tokens.ts` entry for each one. Then a template can
  follow the design system by changing values, not code.
- Today's PDF colours are **not** palette C: `#14334a` / `#253348` / `#536475` / teal `#126677`
  vs light `text #1E293B`, `secondary text #516072`, `primary #2D4E8A`. Fonts also differ:
  DejaVu Sans in the PDF, Nunito + Noto Sans Armenian in the UI.
- **Decision needed (D1):** (a) keep today's colours exactly, so the refactor stays provably
  output-identical, or (b) switch `classic` to palette C light colours in the same PR (text and
  links identical; only the colours change, all already ≥ 4.5:1 on white per `ui-plan.md`).
  Recommended: **(b)**, as a separate commit after the output-identical refactor, so each step
  is reviewable alone.
- Fonts stay DejaVu Sans: changing to Nunito + Noto Sans Armenian means bundling two more
  licensed TTFs and redoing the three-script glyph check (M8 D1). That is out of scope.

## 6. Tests and proof (Phase 2/3 will do)

- Existing 6 unit tests pass unchanged (behaviour-preserving); add builder unit tests (empty section skipped, bad URL dropped, url==text de-dup, order).
- Golden check: render a fixed `ResumeData` before and after the refactor; extracted text and annotations identical (pdfjs, as the existing tests do).
- Prove each guard by removing it (time, pages, bytes) — existing tests must fail.
- `npm run verify`, `npm run test:coverage` (≥90%), `npm run test:int` incl. `resume.int.test.ts`; real run of `POST /v1/me/resume` and check the PDF — **needs Auth0 token; not available locally yet**, so Phase 3 real run depends on Levon's tenant details (or the test JWKS helper in the integration suite).
- Update `vitest.config.mts` coverage exclusions if paths move (`templates/` is new, `utils/` unchanged).

## 7. PR breakdown

1. This plan (docs PR, one review round, then merge).
2. Implementation PR: builder + template + renderer refactor + tests (single coherent chunk;
   palette C colours as its last commit if D1 = b).

## 8. Answers and open questions

Answered by the user, 2026-11-02:

1. "Builder" means the code-level refactor (A). (B) stays with T28 and Levon.
2. No second template, no sample script.
3. Claude Design: the approved prototype and `tokens.ts`, as in §5.

Open:

- D1 in §5: keep today's colours, or palette C.
- Auth0 tenant details for the real run: waiting on Levon. Until then, Phase 3 relies on the
  integration suite's local JWKS tokens (`src/testing/jwks.ts`), which run the real endpoint
  over HTTP.

## 9. Not verified

Integration test and real HTTP run; PDFKit behaviour beyond the existing unit tests. The
Claude Design artifact was read only as a summary (no token values visible there).
