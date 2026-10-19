# From the M7 lead: findings that are NOT M7 (2026-10-16)

Found by Levon while testing M7 on production. The M7 lead does not fix these; please put
them in the tracker and assign them.

## 1. Clicking a tag chip leads to a 404 (M6, tags)

Levon clicked a tag on an imported (draft) project and landed on the 404 page.
Likely cause, not verified: the tag registry and `/tags/<name>` only know tags of
**public** projects (privacy rule, Q3: an unknown tag is a 404). Tags on a draft or private
project are shown on the card but have no page. Fix options: do not render a draft's tag as
a link, or show an empty tag page for an owner's own tags. Needs a decision.

## 2. Dark theme: the user name in the bottom-left corner of the sidebar is unreadable (M3 UI)

The name uses a dark colour on a dark background. Also: dark-mode contained primary
buttons are 4.46:1 on hover (`#0b0f18` on `#647ba2`), just under 4.5:1.

## 3. Auth0 user lifecycle (M2 decision, now visible)

Deleting an account deletes the app's data and revokes GitHub, but the Auth0 user stays
(m2: "the login outlives the account"). With linked identities this leaves debris: a
deleted-then-reconnected GitHub account hits "Auth0 refused to link" (400, Auth0 sees the
identity already linked to the same user). The M7 lead handles the GitHub part
(unlink on delete, idempotent link). Open for the tracker: should account deletion also
delete the Auth0 user (needs `delete:users` on the M2M app, a privilege increase)? Levon
leans yes.

## 4. Flaky e2e `discovery.spec` "suggestions open" (fixed in FE #110, once merged)

Cause: the `<title>` is replaced a moment after the URL changes; axe `document-title`
saw none. The test now waits for the title.

## 5. Process

- 10 of 14 M7 PRs were merged from Levon's account outside the lead's gate, two with
  unresolved Codex findings (#101, #107).
- `gradfolio` main checkout is 75+ commits behind `origin/main` and has an uncommitted
  `AGENTS.md` edit.
