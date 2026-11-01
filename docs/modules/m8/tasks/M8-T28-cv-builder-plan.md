# M8-T28: CV builder: investigation and plan

**Repo:** gradfolio-api, gradfolio (a docs PR in gradfolio-api) · **Depends on:** — · **Tracker:** 8.9 · **Size:** one docs PR, then a stop

## Context

Today the student can **import** data (GitHub, and LinkedIn once the exports exist) and
**export** one résumé PDF with a click: a single template, checkboxes for sections and projects,
a language. The wording in the file is the profile's wording. Levon asked (2026-11-01) for a
**CV builder, not just import**: the student composes a CV, not only downloads one.

This is bigger than a button. The first task is a plan he can accept or cut.

## Goal

`docs/modules/m8/cv-builder-plan.md`: what a CV builder means for Gradfolio, what it costs, how it
splits into tasks, and what to cut for v1.0. Then **stop**. Levon decides; the main chat then
writes the implementation briefs (T29 onwards).

## Scope

In (run, measure and cite live pages; do not recall):

1. **What the competition does.** Reactive Resume, Novoresume, LinkedIn's résumé builder, a
   template system such as Overleaf: editor layout, templates, tailoring to a job, export formats.
   A short table with links and the date checked.
2. **The model. Decide with a recommendation.**
   - A CV is a saved document. A student can keep several ("software roles", "research").
   - Is it a **live view** of the profile with per-CV overrides (a different headline and summary,
     reworded bullets, hidden or reordered entries), or a **snapshot** that stops following the
     profile? Recommended: live view plus overrides, so editing the profile updates every CV
     unless that part was overridden. Say what each choice costs.
   - Where the data lives: new tables (an additive migration, safe while the previous revision
     serves), limits per user, what happens on account deletion.
3. **The experience.** Editor with a live preview, adding and reordering sections and entries,
   per-entry text edits, autosave, a template and a language per CV (independent of the UI
   language, as in M8). Sketch two screens at 390 and 1440.
4. **Templates.** Two or three to start (single column and ATS-friendly first), A4 and Letter,
   with Armenian, Cyrillic and Latin glyphs. How a template is defined so more can be added.
5. **Output.** PDF only in v1.0, reusing the PDFKit renderer from T2? Anything else (DOCX, a
   public share link) is a separate decision. Say what each would cost.
6. **Privacy.** The same rule as the current export: private and draft projects appear only by
   explicit choice per CV. A shared link, if any, never exposes private data.
7. **The link with imports.** After a GitHub or LinkedIn import, offer "Build a CV from this".
8. **The split.** A list of independently shippable tasks with a repo, dependencies and an
   estimate in days, a first slice that is useful alone, and which tasks to cut if time is short.
   The v1.0 deadline and the other open work (M7 LinkedIn, M9) are in the tracker.
9. **Risks and open questions.**

Out: any code. The existing export keeps working.

## Acceptance

- The plan is a docs PR with the comparison table, the model recommendation, the sketches, the
  task split with estimates, and a section "Cut line for v1.0".
- No claim is made from memory; every price, limit and feature has a link.

## Needs Levon

Whether the CV builder is in v1.0 at all, the model (live view or snapshot), and the cut line.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
Report in the PR body (`docs/process/handoff-template.md` part 2). Do not merge. Never write a
secret into a file, a PR or a chat.
