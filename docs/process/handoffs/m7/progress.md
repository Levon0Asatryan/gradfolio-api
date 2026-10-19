# M7 progress for the main chat (2026-10-18, 18:45 Yerevan)

Interim. The full interim report is m7-report.md (written 2026-10-15); this file adds what
changed since. Non-M7 findings are in m7-findings-for-orchestrator.md.

## Merged since the interim report

| PR            | What                                                                    | Merged by                                                        |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| API #82       | d1 suggestions: GitHub profile data + LinkedIn sign-in (migration 0009) | lead, `d7e18f4`, Codex clean on `0a4db51`, deployed, /readyz 200 |
| API #83       | b3: repo search `q`, import preview, per-repo overrides                 | lead, `f131ba6`, Codex clean on `3d42216`, deployed, /readyz 200 |
| FE #108       | delete account ends in sign-out and cannot recreate the account         | lead, `76cd1d5`, Codex clean on `8655171`, deployed              |
| FE #109       | GitHub import dialog, re-sync card, source badge (3a)                   | Levon's account (outside the gate)                               |
| FE #110       | fix for the discovery.spec "suggestions open" axe flake                 | Levon's account                                                  |
| FE #106, #107 | AUTH0_DOMAIN with scheme; configurable connection Name                  | Levon's account                                                  |

## Open

- FE #111 (profile-data tab, 3b), FE #112 (hover contrast of contained buttons 4.5:1).
- WIP, not pushed (agents hit their usage limit; reset ~22:40 Yerevan):
  - API `m7/link-idempotent`: fix "Auth0 refused to link" after delete + reconnect (cause
    proven only by hypothesis: identity stays linked to the same Auth0 user; Auth0 answers 400),
    idempotent link, unlink the GitHub identity on account deletion, log Auth0's 400 reason.
  - FE `m7/draft-publish`: "Draft" chip on cards, quick Publish without the edit form.

## Verified on production (2026-10-15/16, by Levon)

GitHub connect works (after the AUTH0_DOMAIN and connection-Name fixes); GitHub import
created draft projects; account deletion revoked the GitHub grant (log).

## Not verified

Delete-account sign-out after #108 (Levon has not confirmed); real re-sync, publish and
disconnect; anything LinkedIn (exports M7-T1 still missing).

## Product requests from Levon (M7 scope, queued for the agents)

- Import every useful thing GitHub offers into user data (skills from repo languages/topics,
  links, orgs) as suggestions; skill suggestions from the user's own project technologies.
- Notify and suggest an update when a repo's README/description changes (d2).
- Account deletion should also remove the Auth0 user (needs `delete:users`: M7-T13).
