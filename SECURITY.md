# Security policy

Gradfolio stores personal data about students: contact details, education history,
and OAuth tokens for their linked GitHub and LinkedIn accounts. It also renders
rich text that users write. That makes security reports important, even though this
is a university coursework project.

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through GitHub:

1. Go to the repository's
   [Security tab](https://github.com/Levon0Asatryan/gradfolio-api/security).
2. Choose **Report a vulnerability**.

That opens a private advisory that only you and the maintainer can see. Please
include:

- what an attacker can do;
- the steps or request that demonstrate it;
- the commit you tested against.

You can expect an acknowledgement within a week. A fix for a confirmed issue is
developed privately and released before the advisory is published. You are credited
unless you ask not to be.

## Supported versions

There are no releases yet. Only the latest commit on `main` is supported, and fixes
land there.

## What is in scope

The areas where a finding matters most:

- **Access between users.** One user reading or changing another user's profile
  sections, projects, attachments, team invitations, notifications or integrations.
  This includes a private profile or project reaching anyone the privacy rules
  exclude.
- **Private fields.** Birthday, phone number, OAuth tokens and Auth0 identifiers
  appearing in a response they do not belong in, in a log line or in an error.
- **Stored cross-site scripting.** Project descriptions are rich text, stored as HTML
  and rendered by the frontend. HTML that survives the server-side sanitizer and runs
  script in a viewer's browser is in scope.
- **Authentication.** Access-token verification: signature, issuer, audience and
  expiry. Also the mapping from an Auth0 identity to a Gradfolio account.
- **Server-side request forgery.** Any path where the server fetches a URL a user
  supplied.
- **Injection** of any kind through request fields.

## Out of scope

- Findings that need an already-compromised host, database or configuration.
- Denial of service by sheer volume against a deployment you run yourself.
- Missing hardening headers or best practices with no demonstrated impact.
- Vulnerabilities in dependencies with no exploitable path through gradfolio-api.
  Dependabot tracks those.
- The frontend ([gradfolio](https://github.com/Levon0Asatryan/gradfolio)) and the
  schema repository. Report those there, the same way.
