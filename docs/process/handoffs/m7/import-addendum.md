M7 addendum from the orchestrator (gradfolio-repos-d8), Levon's product decision
(2026-10-16) for the GitHub import UX. It shapes FE PR 3 (7.14) and API PR (d) (7.13).
Reply with a short plan (the PR split, and API changes if any) before building.

**7.13 is confirmed:** GitHub profile data is offered as suggestions, never overwritten
silently.

## 1. Right after connecting GitHub: an import modal

When the GitHub connect callback returns successfully, open a modal immediately. It
asks what to bring in:

- **Repositories:**
  - a list of the user's repos, with search;
  - each row shows the name, description, language and stars;
  - every repo is unselected by default;
  - a repo already imported is shown as "Imported" and can't be selected again.
- **Profile data:** the avatar, name, bio, company, location and blog/website, as
  suggestions.
  - Each field shows the current value next to GitHub's value, and has its own
    checkbox.
  - A field whose value is the same on both sides is hidden.
  - An empty profile field is pre-checked; a filled one is unchecked.
- **Buttons:**
  - **Continue** goes to the review step;
  - **Not now** closes the modal, and nothing is imported.

## 2. The review step: edit before saving

For each selected repo, show the draft project that will be created:

- the title, summary, description from the README (sanitized), technologies and
  links;
- the user can edit any field here;
- the user can unselect a repo here.

**Save** creates the projects as **drafts** in one request (the existing import API),
then shows a result. For example: "3 projects created as drafts. Publish them from
your projects page."

Profile fields that were ticked are saved through the profile API in the same step.

## 3. Import later, from two places

- **Integrations page:** the GitHub card gets an "Import from GitHub" button, which
  opens the same modal.
- **Projects → Add:** when GitHub is connected, Add offers two choices:
  - "Create manually" (today's form);
  - "Import from GitHub" (the same modal, opened on the repos tab).

  When GitHub isn't connected, Add goes straight to the form, with a small "Connect
  GitHub to import repos" link.

**One modal component everywhere:** after connecting, from the integrations page, and
from Add.

## 4. Rules

- **Nothing is imported or changed without the user choosing it:** no auto-import
  and no silent profile overwrite. Dismissed profile suggestions are remembered, so
  they don't come back on every connect (that's API (d)).
- **Re-sync stays per project**, and keeps the user's edits (7.4).
- **States:** loading, empty ("No public repositories"), the GitHub rate limit (shown
  with when it resets), and errors, all in en/ru/am.
- **Accessibility:**
  - the modal traps focus, Escape closes it, and focus returns to the trigger;
  - keyboard selection works in the repo list;
  - the axe scan shows 0 serious or critical violations.
- **Playwright:**
  - the connect → modal → review → save path against stubbed API data, in CI;
  - the real path on production as a queue row (M7-T4/T6).
- **API calls:** server-side only (Q11), as before.

## 5. Process reminder

The lead merges only when Codex (or the reviewer sub-agent) has no open findings on
the head, CI is green and threads are resolved. Record each PR's reviewer and merger
in `m7-report.md`.
