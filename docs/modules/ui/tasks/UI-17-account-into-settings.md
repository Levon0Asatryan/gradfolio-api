# UI-17: Merge the Account page into Settings

**Repo:** gradfolio · **Depends on:** — · **Tracker:** UI track (UI-17) · **Size:** a proposal, then one or two PRs

## Context

There are two pages for "my account": **Account** (`/account`, signed in only) and **Settings**
(`/settings`, open to everyone). Levon wants them to be one place: Account moves into Settings,
for example **under a tab** or something like it (2026-11-01).

| Page         | Route       | Who       | Holds today                                                                                                                 |
| ------------ | ----------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Account**  | `/account`  | signed in | the account summary (name, email, avatar), the public-profile switch and the contact email, linked accounts, delete account |
| **Settings** | `/settings` | everyone  | interface language, theme, and (signed in) the invitation-email switch and the email language, added in M8                  |

Both have an entry in the menu (`src/components/navigation/navItems.tsx`).

## Goal

One page for the account and the settings. A student finds everything about their account and
their preferences in one place, and no old link breaks.

## Scope

In:

1. **Propose the structure with a sketch at 390 and 1440, then build it. Levon approves the
   sketch.** Levon suggested tabs; the proposal may offer sections or a side list if tabs do not
   fit, with the reason.
2. **Signed-out visitors.** Settings stays open to everyone for language and theme. The account
   parts need a session: say what a signed-out visitor sees (the tab hidden, or a sign-in prompt
   with a return to the same tab), without making `/settings` a protected route for everyone.
3. **The place in the URL.** A tab (or section) can be linked to and reloaded, and Back works.
4. **Old routes.** `/account` keeps working for anyone with the link and goes to the right
   place. `robots.ts` and the route policy (`src/lib/auth/routePolicy.ts`) are updated.
5. **Everything that points at `/account` moves with it.** Found by search on 2026-11-01:
   the dashboard's "complete your contact email" link, the suggestions count badge on the
   Account menu item (`NavCount`), the sign-in return address in `AccountSummary`, the menu on
   desktop and phone, the e2e specs (`delete-account`, `guest-navigation`, `notifications`,
   `smoke`), and the docs. Search again before starting; the list may have grown.
6. **The menu** loses the separate "Account" entry (or keeps it as a shortcut, if the proposal
   gives a reason), and the suggestions count stays visible where students look for it.
7. **Quality bar.** Every string in en/ru/hy (Armenian labels are longer: check the tab row on a
   phone). Keyboard: a proper tab list (arrow keys, focus, `aria` roles) or the equivalent for
   the chosen structure. Delete-account keeps its confirmation and its sign-out (M7 #108).
   Light and dark. Playwright at 390 and 1440 in en/ru/hy with axe: 0 serious or critical.

Out: new settings, new account features, the CV builder.

## Acceptance

- `npm run verify`, coverage, build and the e2e suite.
- Every old link to `/account` still lands on the right content (a test for each).
- A signed-out visitor still changes language and theme; a signed-in student reaches every
  former Account feature from Settings.

## Needs Levon

Approval of the sketch.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon"). Read the repo's
`CLAUDE.md` and `AGENTS.md` first. Report in the PR body (`docs/process/handoff-template.md`
part 2). Do not merge. Never write a secret into a file, a PR or a chat.
