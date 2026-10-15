# UI/UX redesign: plan, todo, proposed tracker changes

Owner: M3 lead chat. Decided by Levon on 2026-10-05: palette C (Blue + Magenta + Amber),
prototype approved (https://claude.ai/artifact/XR1nnxZ2niPcyDBADdDgFU), logo option A (Cap)
(https://claude.ai/artifact/NafXD7WqvTYqSi5LkDoaps), Profile and Account stay separate.
The prototype is the acceptance spec for every PR below.

Rules: each PR from a fresh `origin/main` (never stacked), full gate + real run in the browser
(light/dark, en/ru/am, desktop full-screen + phone), prototype-vs-app comparison, both
reviewers, no merge by agents. Nothing that calls the API merges unless the live API is up (it is).

## Todo

### M3 close-out

- [x] API: plan #25, (a) #26, (b) #27, (c) #28, deadlock fix #29, email-as-name fix #37, verification doc #38 (all merged)
- [x] FE: preview login #22, profile read #23, header/account/onboarding #25, sections #31, inputs #32, guards #33 (all merged)
- [x] Dependabot PRs handled (merged, #28 closed: icons 9 needs MUI 9)
- [ ] FE verification record (docs; after the redesign PRs that touch the same pages, or now if separate)
- [ ] Final M3 report to the orchestrator (format: handoff-template part 2, items marked [api]/[fe])
- [ ] Remove worktrees (`gradfolio-api-m3`, `gradfolio-m3`, `gradfolio-ui` after the redesign), delete dead branches (remote `m3/profile-edit` etc.), stop dev server/browser
- [ ] Levon: Auth0 origin lists (auth0-setup §10.5), Auth0 callback entries for merged branches, `/` stays protected (decided)

### Redesign PRs (FE, agent: UI agent)

- [~] PR1 theme: palette C tokens, type scale, component overrides, Noto Sans Armenian, `lang`, `<main>` (gradfolio#34 open, CI green, awaiting Codex)
- [ ] PR2 navigation + layout: labelled nav at every width (sidebar / rail / bottom bar + More), Profile item separate from Account, 44px targets, resize-handle fix
- [ ] PR-logo: new logo (option A) in sidebar, favicon, app icons, manifest, og image, metadata; `/brand/auth0-logo-512.png` public
- [ ] PR3 profile edit model: no global mode, per-section pencil/Add, dialogs with Save/Cancel, toasts, empty-state prompts, delete confirm naming the entry, completeness hint, reorder up/down, unsaved guard on in-app navigation
- [ ] PR4 Account + Settings in palette C (the `ui/account` work)
- [ ] PR5 dashboard + projects + search visual pass (welcome, next-step meter, category chips in category colors)
- [ ] Auth0 branding: logo URL (`https://<prod host>/brand/auth0-logo-512.png`) and primary color (palette C primary) in Universal Login. Orchestrator via Auth0 MCP; else Levon by hand
- [ ] Levon to confirm provisional og tagline "Your projects, backed by evidence." and "Student portfolios for NPUA"
- [ ] Native review of ru/am strings (machine-drafted in the prototype and some app strings)

### FINAL STEP, after M3 and PR1–PR5: recheck and polish everything

- [ ] Full-app pass in the browser: every page, en/ru/am, light/dark, 390/768/1024/1440/full-screen; compare to the prototype
- [ ] Design critique, accessibility (WCAG 2.1 AA) and UX-copy review of every screen; keyboard-only walkthrough; touch targets; focus order; reduced motion
- [ ] Remaining pages not yet redesigned: integrations, connections stepper (to be redesigned with 2.14), projects/new, project detail, 404
- [ ] Console clean (no warnings), no hardcoded English, no layout shift, loading/empty/error states consistent
- [ ] Performance check (Lighthouse on key pages), image hosts, fonts
- [ ] Fix list as small PRs; record results in a FE verification record

## Proposed tracker changes (the orchestrator edits the tracker)

- Decisions: Q3 = A (private profile 404 except owner); 3.6 in v1 (DELETE /v1/me, DB only, Auth0 login stays); Q5 decided in M3 (FE pins an API commit, `openapi-typescript`, CI drift test). `/` stays protected; public pages: `/profile/[id]`, `/projects/[id]`, `/search`.
- M3 rows 3.1–3.10, 2.12, 2.14: done once the FE verification record exists.
- New track "UI": UI-1 design system + palette C theme; UI-2 navigation/layout; UI-3 logo + favicon + app icons; UI-4 profile edit model; UI-5 account/settings; UI-6 dashboard/projects/search; UI-7 Auth0 branding (logo, colors); **UI-8 final recheck and polish of the whole app (last step, after everything else)**.
- Follow-ups: API to publish string limits in `openapi.yaml`; browser Back can drop a dirty edit; anonymous profile views share the FE server's rate-limit address; notifications naming deleted users (M5); oasdiff breaking-change check; CI check that FE `openapi.yaml` equals the API's at the pinned sha; Gravatar avatar URL derives from the login email (hash); earlier rows with name = email (none known); remove Auth0 callback/logout entries of merged branches; ru/am native review.
- Process notes: review receipts were self-reviews (the review skill only gives instructions); a PR merged before its review round (FE #31 → fixes moved to #32/#33); do not request reviews on merged PRs.
