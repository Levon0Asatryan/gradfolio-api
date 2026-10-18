M5 scope addendum from the orchestrator (gradfolio-repos-d8), at Levon's request: add a
Teams page to M5. The updated prompt is
/Users/levon/Dev/university/gradfolio-repos/m5-prompt.md.

You are already at verification, so add this as new PRs after your current ones.
Don't reopen or stack on the merged ones. Before starting, reply with a short plan:
the PR split, and anything Q4 or your merged contract changes.

1. **[api] 5.8 `GET /v1/me/teams`.** One call returns:
   - projects the caller owns, with their members and each member's status;
   - projects where the caller is an accepted member;
   - invites waiting for the caller (incoming);
   - invites the caller sent (outgoing).

   Requirements:
   - paginated and scoped to the caller;
   - no N+1 queries (assert the query count in a test);
   - in `openapi.yaml`, a request in `http/`, a second-user test, rate-limited.

   Also `POST …/leave`, if Q4 as decided allows a teammate to leave (skip it if Q4
   said no). It notifies the owner in the same transaction.

2. **[fe] 5.9 the Teams page** (`/teams`), a new labelled nav item in the sidebar,
   the rail and the phone bar.
   - **Invites:** incoming, with accept/reject; outgoing, with cancel.
   - **My projects' teams:** each owned project with its members, plus invite and
     remove.
   - **Projects I'm on:** leave, with a confirm dialog.
   - Empty states that point to a next step.
   - Reuse the project page's team components: one implementation, not two.
   - en/ru/am, server-side calls only (Q11).
   - Playwright checks as in the brief: screenshots at 390 and 1440 in light/dark and
     en/ru/am, a keyboard walkthrough, axe with 0 serious/critical, a clean console.
3. **Order:** API 5.8 merges and deploys (`/readyz` 200) before the FE page merges.
4. **Final test additions:**
   - the two-account run covers leave (A notified) and checks `GET /v1/me/teams`
     against the stored rows at each step;
   - both verification docs get a 5.8/5.9 section.
5. **Out of M5:** a team as its own entity (a named group across projects). It needs
   new tables, so list it under follow-ups as stretch only.

Same rules as before:

- review rounds;
- no merging;
- no edits to `tracker.md`;
- propose tracker changes in your report.

**Also: Levon's manual queue.**

- Anything that needs Levon (a login, a token, a dashboard click, a decision) goes as
  a row in `/Users/levon/Dev/university/gradfolio-repos/manual-testing.md`, under an
  M5 ID (`M5-Tn`).
- Each row gives the exact steps, the time, who continues afterwards, and the
  document it fills in.
- First run every check that needs no login yourself.
- Put the ID in your report.
