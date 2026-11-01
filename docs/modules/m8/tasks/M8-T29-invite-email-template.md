# M8-T29: The invite email template

**Repo:** gradfolio-api · **Depends on:** — (T21 sends the result, so this comes first) · **Tracker:** 8.7 · **Size:** one PR, after a design proposal

## Context

Levon found that SendGrid has no template (2026-11-01). He is right in two ways. SendGrid holds
no template because the system never sends one: `src/core/email/templates.ts` builds the message
in our own code and `sendgrid.ts` posts it as plain `text/plain` and `text/html` content. And
what it builds is not a designed email:

- the HTML is `<html><body>` with one paragraph and two links: no layout, no logo, no colours, no
  button, no footer saying who sends this and why;
- there is no preview text (the line mail clients show next to the subject);
- there is no `List-Unsubscribe` header, so mail clients cannot show their own "unsubscribe"
  button, which also helps deliverability;
- the three languages (en, ru, hy) share the same bare shape.

The click tracking is already off (good: the links stay ours). Keep it off.

## Goal

An invitation email that looks like Gradfolio, reads well in the common mail clients, and is
built so the next email types reuse the same layout.

## Scope

In:

1. **Where the template lives. Propose, with a recommendation. Levon decides.**
   - **A. In our code (recommended).** A shared layout plus a per-email body, rendered by us.
     It is versioned and reviewed in git, tested (escaping, links, languages), works with any
     provider (the Resend adapter, a new provider after the SendGrid trial ends), and needs no
     SendGrid dashboard.
   - **B. A SendGrid Dynamic Template.** Edited in their dashboard and filled with
     `dynamic_template_data`. A designer can change it without a deploy, but it is not in git,
     it cannot be tested in CI, it ties us to SendGrid, and it disappears with the account when
     the trial ends on 2026-12-22.
2. **The design** (for A): one column, 600 px, table-based layout with inline styles (mail
   clients ignore most CSS), the Gradfolio logo (a PNG on our own frontend host with a stated
   width, never SVG), the palette from the app, one clear button ("Open Teams"), the plain link
   under it, a hidden preview-text line, and a footer: who sends it, why the reader got it
   (they were invited to a project), the unsubscribe link, and the Settings link. Dark-mode safe
   (no pure white image backgrounds, a transparent logo that works on both).
3. **Three languages.** en, ru and hy, each with its own subject, preview text, body and footer.
   Armenian and Russian text render in the system fonts of mail clients: check line breaks.
4. **Plain text part:** the same content, readable, not a stripped copy of the HTML.
5. **Headers:** `List-Unsubscribe` with the signed unsubscribe URL (and the one-click form,
   RFC 8058, if the endpoint can accept the POST). Click tracking stays off.
6. **Safety:** every inserted value (project title, inviter name) is escaped; a long or hostile
   title (HTML, a very long word, emoji, right-to-left text) cannot break the layout or inject
   markup. Links only point to our frontend host (the existing check stays).
7. **Tests:** golden files for the three languages; a hostile-title test; a test that every link
   is on our host; the preview text and the `List-Unsubscribe` header are present. Prove a guard
   by removal: the escaping.
8. **Preview before it is sent:** a local command or a docs script that renders each language to
   an HTML file, and a Playwright screenshot at 600 px and 375 px attached to the PR.
9. **Real clients, after T21 sends it:** a screenshot from Gmail (web and phone), Apple Mail or
   Outlook web, in light and dark mode, for each language, redacted, in
   [../verification.md](../verification.md).

Out: other email types, a template editor, marketing mail.

## Acceptance

- The proposal is approved (the place and a screenshot of the design), then the PR passes the
  repo checks with the new tests.
- T21 sends this template, not the old one, and the verification record shows the real-client
  screenshots.

## Needs Levon

The choice between A and B, and approval of the look (logo, colours, button text).
Narek's `gradfolio.app@gmail.com` stays the Single Sender; the display name is "Gradfolio".

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M8 rules). Read the repo's `CLAUDE.md` and `AGENTS.md` first.
Report in the PR body (`docs/process/handoff-template.md` part 2). Do not merge. Never write a
secret into a file, a PR or a chat.
