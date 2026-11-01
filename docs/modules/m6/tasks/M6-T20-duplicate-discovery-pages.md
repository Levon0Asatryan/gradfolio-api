# M6-T20: Three public pages that duplicate each other

**Repo:** gradfolio · **Depends on:** — · **Tracker:** 6.8, 6.9 · **Reopens:** M6 (discovery) · **Type:** problem, to be investigated and decided

## The problem

The public part of the site has three pages that show largely the same thing, and a visitor has
to choose between them without knowing what is different.

| Menu entry (label)  | Route              | What it shows                                                                                                                   |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Explore**         | `/search`          | A landing with a tag cloud, the 6 newest projects and the 6 newest people. With a query: results grouped as people and projects |
| **Public projects** | `/browse/projects` | A gallery of projects with filters and paging                                                                                   |
| **People**          | `/browse/people`   | A directory of people with filters and paging                                                                                   |

They sit next to each other in the navigation (`src/components/navigation/navItems.tsx`).
Explore already shows newest projects and newest people, which is what the other two show as
full lists. Search on Explore returns the same people and projects the other two list. The
signed-in menu adds "My projects" (`/projects`), which makes "Projects", "Public projects" and
"Explore" three labels for overlapping things.

## Why it is a problem

- A visitor cannot tell which page to use, so the same content is reached by three routes.
- The same cards, filters and lists exist in more than one place, so a change (a filter, a card,
  a label) has to be made, translated (en/ru/hy) and tested more than once, and the copies drift.
- Search engines see several near-identical public pages.
- The navigation has more entries than the site has distinct places.

## What this ticket is

An investigation and a decision, not a design:

1. Confirm the overlap with evidence: which content, filters, cards and components each page
   shares, and what (if anything) only one page offers. Include the navigation labels in en, ru
   and hy and the analytics or log numbers of who uses which page, if there are any.
2. State what a visitor and a recruiter (spec §8d) actually need from the public part.
3. Report the options and their cost to Levon, with a recommendation. **Levon decides.**
4. After the decision, the main chat writes the implementation tickets.

## Done when

- The duplication is removed as decided, and every old route still resolves for anyone who has
  the link.
- The decision and the evidence are in the PR.

## Needs Levon

The decision after the investigation.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon"). Read the repo's
`CLAUDE.md` and `AGENTS.md` first. Report in the PR body (`docs/process/handoff-template.md`
part 2). Do not merge. Never write a secret into a file, a PR or a chat.
