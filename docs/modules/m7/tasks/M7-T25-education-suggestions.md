# M7-T25: Education and organisation suggestions from verified emails and orgs

**Repo:** gradfolio-api · **Depends on:** — (the domain arrived, queue M7-T10 done) · **Tracker:** 7.13 (proposed) · **Size:** one PR
**Status:** ready. Levon gave the domain on 2026-10-19: every university address ends in `polytechnic.am`.

## Context

GitHub exposes `GET /user/emails` (the connection already has the Email scope) and
`GET /users/{login}/orgs` (public orgs, no scope). A verified address on a university
domain is evidence of study there. Plan §6 and §14. Config `UNIVERSITY_DOMAINS` is
designed but empty; production gets `polytechnic.am` after the merge (Cloud Run env var, the
module chat sets it with Levon's OK).

## Goal

A student with a verified `…@polytechnic.am` address is offered an education entry; a
public organisation matching a configured list is offered as experience or education.

## Scope

In: kinds `education.add` and `experience.add` (empty-state only: not offered when an
entry for the same institution exists), `UNIVERSITY_DOMAINS` and an organisation list as
config, OpenAPI, tests with a fake GitHub, ownership and second-user 404.
Out: UI (T32); any email shown to anyone (the address is only compared, never stored or
returned).

## Decisions

Made (Levon, 2026-10-19): `UNIVERSITY_DOMAINS=polytechnic.am` (a domain matches itself and any
subdomain, compared case-insensitively on the part after the last `@`; never a suffix trick such
as `evilpolytechnic.am`, which must NOT match: test it). The institution name offered is
"National Polytechnic University of Armenia" (a config value, `UNIVERSITY_NAME`).
Organisations: **in, but only for a configured list** (`UNIVERSITY_ORGS`, default empty, so no
organisation is offered until Levon names one). **Levon decides:** the organisation names, later.

## Acceptance

- A verified email on a listed domain yields one `education.add` with the institution name
  from config; an unverified one, none. No email appears in any response or log (grep).
- Guards proved by removal: verified-only, domain match, no-duplicate rule.

## Rules

Follow [../../README.md](../../README.md) (chat levels, merging, "Needs Levon") and
[../README.md](../README.md) (M7 rules). Read the repo's `CLAUDE.md` and `AGENTS.md`
first. For a frontend task the chat starts in `gradfolio` and reads this brief from
`../gradfolio-api/docs/modules/m7/tasks/`. Report in the PR body, in the format from
`docs/process/handoff-template.md` part 2. Do not merge. Never write a secret, a token or
real LinkedIn data into a file, a PR or a chat.
