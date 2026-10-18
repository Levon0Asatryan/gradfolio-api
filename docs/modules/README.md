# Modules

Every milestone has its own folder here. **[../tracker.md](../tracker.md) is the
general plan:** each module row there links to its folder. The folder's `README.md`
splits the module into tasks, and each task has its own brief in `tasks/`.

```
tracker.md                      general plan: modules, decisions, follow-ups, risks
└── modules/mN/README.md        one module: its tasks, order, status, exit
    └── modules/mN/tasks/*.md   one task: a self-contained brief for one task chat
```

M1–M6 and the deploy were built before this layout existed. Each folder holds that
module's `plan.md` and `verification.md`, and its README links the prompt and report in
[../process/handoffs/](../process/handoffs/README.md). M7 is still in progress; its
documents move here when it closes.

## Modules

| Module                     | Status      | Folder                      |
| -------------------------- | ----------- | --------------------------- |
| M1 Data layer              | done        | [m1/](m1/README.md)         |
| M2 Auth and identity       | done        | [m2/](m2/README.md)         |
| M3 Profiles                | done        | [m3/](m3/README.md)         |
| Deploy (GCP)               | done        | [deploy/](deploy/README.md) |
| M4 Projects and media      | done        | [m4/](m4/README.md)         |
| M5 Teams and notifications | done        | [m5/](m5/README.md)         |
| M6 Discovery and dashboard | done        | [m6/](m6/README.md)         |
| M7 GitHub and LinkedIn     | in progress | [m7/](m7/README.md)         |
| M8 Utilities and email     | next        | [m8/](m8/README.md)         |
| M9 Hardening and release   | todo        | [m9/](m9/README.md)         |
| UI redesign and polish     | in progress | [ui/](ui/README.md)         |

## How work is done: three levels of chats

From M8 on (decided by Levon, 2026-10-18), work runs on three levels. A module can be
given to another team member, who runs its module chat and task chats on their own
machine.

| Level           | How many                   | Owns                                                                                                                                                                      | Never                                                    |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Main chat**   | one (Levon's orchestrator) | `tracker.md`, the split of each module into tasks, cross-module decisions and follow-ups, checking finished modules against GitHub, Levon's queue of manual actions       | writes feature code                                      |
| **Module chat** | one per module in progress | its folder: refines the task briefs, starts task chats, sequences them, owns the review waits and merges, keeps the task table's status current, writes the module report | edits `tracker.md` or another module's folder            |
| **Task chat**   | one per task               | exactly one task brief: the four phases, one PR (or the PRs the brief names), the report in the PR body                                                                   | starts other work, edits other briefs, merges its own PR |

### Starting a task chat

The module chat (or the person running the module) starts a new chat in the repo the
task names, and gives it:

```
You are the task chat for <task ID> on Gradfolio. Read CLAUDE.md and AGENTS.md first,
then docs/modules/<module>/README.md and docs/modules/<module>/tasks/<task file>.
Do exactly that task. Report in the PR body in the format from
docs/process/handoff-template.md, part 2. Do not merge.
```

For a frontend task, the chat starts in `gradfolio`. It reads the brief from
`gradfolio-api` (`../gradfolio-api/docs/modules/...`), because the plan of record
lives there.

### Status and reports

- **The task table in a module's README is the status of record for its tasks.** The
  module chat updates it in small docs PRs as tasks move: `todo` → `in progress` →
  `review` → `done`.
- **The tracker shows each module's overall status** and links to the folder. The main
  chat syncs it when a module reaches a stop point.
- **A task chat's report goes in its PR body**, in part 2 of the handoff template.
  The module chat collects these into the module's `report.md` when the module closes.
- **Anything only Levon can do** (a GCP, Auth0 or Vercel click, a decision, a login) is
  listed in the PR body and the module report under **"Needs Levon"**, with exact
  steps. The main chat copies it into Levon's queue.
- **Never put secrets in a brief, a PR or a report:** no passwords, tokens or keys.

### Merging

The module chat merges a PR only when all of these hold on its current head:

- Codex, or a reviewer sub-agent with fresh context, has no unresolved findings;
- CI is green;
- every thread is resolved.

Two more rules:

- **Merge order:** an FE PR that calls a new endpoint merges only after that API PR
  is merged and the API Deploy workflow is green.
- **Migrations:** take the next free number on the latest `main`, and rebase before
  pushing. Other modules may be adding migrations at the same time.

## Writing a task brief

One file per task in `mN/tasks/`, named `<ID>-<slug>.md`. A task is small enough for
one chat and one PR. It names everything the chat needs, so the chat can start cold:

- **Repo** and **depends on** (task IDs that must be merged first);
- **context:** what exists today, with file paths and the tracker rows;
- **goal and scope** (in and out);
- **decisions** already made, and the ones to propose (marked **Levon decides**);
- **acceptance:** the final test, which is concrete and runnable;
- **needs Levon:** clicks or decisions, if any.
