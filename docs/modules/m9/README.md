# M9: Hardening, deployment and v1.0 release

**Status:** todo. Starts after M1–M8 are done. It has not been split into tasks yet; the
main chat does that when M8 is nearly closed, so the split reflects what actually shipped.

Tracker rows: 9.1–9.10 in [../../tracker.md](../../tracker.md#m9-hardening-deployment-and-v10-release).

**Already done ahead of M9:** 9.1 and 9.2 (production database and API on Google Cloud,
see [../deploy/](../deploy/README.md)) and the API half of 9.3.

**Expected tasks, to be written as briefs in `tasks/`:**

| Group             | Tracker rows | Notes                                                             |
| ----------------- | ------------ | ----------------------------------------------------------------- |
| Auth0 production  | 9.4          | A separate production tenant, branding, email templates           |
| Security pass     | 9.5          | Every endpoint's second-user test, XSS corpus, rate limits, audit |
| End-to-end tests  | 9.6          | Playwright is already in the frontend repo (M4)                   |
| Full-system check | 9.7          | A fresh chat drives the whole user journey and only records       |
| Demo data         | 9.8          | Realistic students, projects and teams in en/ru/am, plus reset    |
| Handover docs     | 9.9          | READMEs, architecture overview, user guide, demo script           |
| Release           | 9.10         | Tags, changelog, final tracker                                    |

The motion and polish part of the UI track (UI-9 to UI-16) must finish before 9.7. See
[../ui/](../ui/README.md).
