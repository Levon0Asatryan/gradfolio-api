# M7-T38 — Disconnect dialog and errors match the unlink behaviour (fe)

Depends on: M7-T37 (api #144, deployed).

## Why

Disconnect now revokes the grant and unlinks the GitHub identity at Auth0 (api #144). The answer carries
`githubIdentity`: `unlinked`, `kept` or `none`. The dialog text still says "Your GitHub sign-in stays linked, so
signing in with GitHub still works" (`dialog.disconnectBody`, en/ru/am), which is false for a secondary identity.

## Do

- Read `githubIdentity` from the Disconnect answer. Show a done message per value: `unlinked` (GitHub is free to
  connect to another account), `kept` (GitHub is how you sign in here, so it stays on this account), `none`.
- Rewrite `dialog.disconnectBody` in en, ru, am. Say what Disconnect does: revokes access, and unlinks GitHub unless it
  is the sign-in method.
- Handle `502 GITHUB_UNLINK_FAILED`: the connection is cleared; say so and offer retry.
- Show the two new Connect errors (the GitHub account is that account's sign-in; it is connected to another account) with
  their action text, in en, ru, am.
- Tests fail without each change; Playwright for the three answers; axe; 390/1440, light/dark, en/ru/am.
- Never print tokens or the GitHub login in logs.

## Done when

One fe PR, Codex clean on the head, CI green, Vercel deploy green.
