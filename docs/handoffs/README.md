# Handoffs

The prompt each worker or lead chat was given, and the report it sent back, kept per
milestone. Moved here on 2026-10-15 from the workspace root, where the orchestrator
wrote them.

- **They are a historical record.** Absolute paths, session names and "now" in them
  are as they were at the time.
- **Test-account emails were removed** before they were added here.
- **The format** of prompts and reports is in
  [../handoff-template.md](../handoff-template.md).
- **The status of record is [../tracker.md](../tracker.md)**, not these reports.

| Milestone     | Prompt                       | Report                       | Other                                                                                |
| ------------- | ---------------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| M1 data layer | [prompt](m1/prompt.md)       | in the tracker (M1)          | [follow-up prompt](m1/followup-prompt.md), [follow-up report](m1/followup-report.md) |
| FE setup      | [prompt](fe-setup/prompt.md) | [report](fe-setup/report.md) |                                                                                      |
| M2 auth       | [prompt](m2/prompt.md)       | [report](m2/report.md)       |                                                                                      |
| M3 profiles   | [prompt](m3/prompt.md)       | [report](m3/report.md)       | [UI redesign plan](m3/ui-redesign-plan.md)                                           |
| Deploy (GCP)  | [prompt](deploy/prompt.md)   | [report](deploy/report.md)   |                                                                                      |
| M4 projects   | [prompt](m4/prompt.md)       | [report](m4/report.md)       |                                                                                      |
| M5 teams      | [prompt](m5/prompt.md)       | [report](m5/report.md)       | [Teams page addendum](m5/teams-addendum.md)                                          |
| M6 discovery  | [prompt](m6/prompt.md)       | [report](m6/report.md)       |                                                                                      |

**Still in the workspace root while in use:**

- `m7-prompt.md`, and `m7-report.md` once it exists: they move here when M7 closes.
- `manual-testing.md`, Levon's queue of manual tests and actions. The lead chats edit
  it live, so it stays outside the repo.
