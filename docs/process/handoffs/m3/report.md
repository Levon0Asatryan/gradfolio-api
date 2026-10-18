# M3 lead report 1 (2026-10-04)

Merged:

- [api] gradfolio-api#25 M3 plan, e17a46b. Decisions = plan recommendations (Levon approved by merging): Q3 option A (private profile = 404 to all but owner; excluded from search/browse); 3.6 in v1 (DELETE /v1/me, DB only, Auth0 stays); onboarding moved into PR (a); Q5 decided (FE pins API commit, openapi-typescript, CI diff), moves M4 -> M3.
- [fe] gradfolio#22 per-deployment APP_BASE_URL for previews + /projects/[id] params fix, 0d5ee12. Not done: real preview login proof (Vercel SSO), Auth0 origin-list cleanup (10.5), `/` public vs protected (code protects; 2.10 says public).

Proposed tracker changes:

- Record Q3=A, Q5 decided (M3), 3.6 in v1; 3.5 note no FE reorder UI; 2.9 generated types land in M3.
- New rows: set API_BASE_URL/AUTH0_SCOPE for Preview in Vercel; remove Auth0 callback/logout entries of merged branches; resolve 2.10 `/`.
- Follow-ups: anonymous profile views share FE server rate-limit address; notifications naming deleted users (M5); oasdiff breaking-change check; use `docker-compose` on this machine.

Next: API PR (a) in progress; FE step 2 starts when (a) merges.

# M3 final report (2026-10-06), lead chat

Merged: [api] #25 plan, #26 (a) contract+reads, #27 (b) section writes, #28 (c) DELETE /v1/me, #29 deadlock fix, #37 email-as-name fix, #38 verification doc. [fe] #22 preview login, #23 profile read, #25 header/account/onboarding, #31 sections, #32 inputs, #33 guards, Dependabot (#26/#27/#29/#30 merged, #28 closed: icons 9 needs MUI 9).
UI track (Levon decision: palette C calm, prototype approved, logo A Cap): [fe] #34 theme, #36 nav, #37 logo, #38 spacing, #39 account/settings, #40 calm palette, #41 brand archive (all logos), #42 profile edit model, #43 account fixes, #44 dashboard/projects/search (+ Explore re-render fix), #45 sidebar toggle.
Open (green, Codex no findings, ready for Levon): [fe] #46 (profile Cancel + header toast), #47 (neutral login label).
Real Auth0 token run: done on a database-login test user (the test account), found+fixed email-as-name leak (#37 API). Evidence in gradfolio-api docs/m3-verification.md.

NOT DONE / handed back:

- UI-8 final recheck+polish: audit stopped early at Levon's request; nothing written. Remains a tracker row (every page en/ru/am, light/dark, widths, a11y, Lighthouse, stepper /integrations/connections redesign).
- Auth0 branding (logo https://gradfolio-navy.vercel.app/brand/auth0-logo-512.png, primary #2D4E8A): handed to orchestrator; Levon by hand if not doable.
- Auth0 origin lists (auth0-setup 10.5), Auth0 callback/logout entries for merged branch m3/preview-login, remote branches left on GitHub (merged ones; auto-delete off).
- ru/am native review; og tagline provisional ("Your projects, backed by evidence."); test user the test account may hold edits from agent runs (privacy/contact email were restored by the agents; UI-8 not verified).
- Not verified: logged-in flows for dashboard/projects pages behind real login with live API; reduced-motion runtime; keyboard walkthrough; delete/reorder of a real entry.
  Machine: all agents stopped; dev servers on 3000-3010 gone; no gradfolio docker containers; all worktrees except the two main checkouts removed; local m3/ui branches deleted; scratch screenshots removed.

# M3 + UI wrap-up (2026-10-08), lead chat

Merged since the last note: FE #46 (skills Cancel, header toast), #47 (neutral login label), Dependabot #48/#49/#50/#51 (jsdom, jest-dom 7, @vercel/analytics 2, motion 14), API #39/#40. Closed: FE #52 (knip 6 fails knip check; needs config migration). Final UI pass merged by Levon: #53 (translated 404, dates follow UI language/UTC, tab titles), #54 (connections stepper redesign), #55 (collapsed rail 124px for Armenian labels), #56 (docs/fe-m3-verification.md).
Codex comments on #53 (round 2), #54, #55, #56 landed AFTER merge and were not fixed; tracker follow-ups: dashboard title during legacy localStorage-language migration; formatDay UTC test should assert observable output; stepper step buttons need a visible focus ring; connections page title not localized; StepWelcome heading regression test; AppNavigation test should render Armenian label; verification doc line 33 (dashboard date fix attribution) to be checked. P3: other tab titles stay English in ru/am, 404 tab title, stepper step 2 shows errors before touch and is a local mock, rail toggle 30px (<44px), formatDate.ts unused, knip 6 migration.
Not verified (also in fe-m3-verification.md): dark theme/expanded sidebar by eye only, contrast not measured, keyboard only on stepper, /projects/<id>, visitor profile, onboarding dialog not revisited, forced empty/loading/error states, screen reader, non-Chromium.
Machine: all agents stopped, no dev servers, no gradfolio docker containers, worktrees (all but the two main checkouts) and local m3/ui branches removed. Remote merged branches left on GitHub.
