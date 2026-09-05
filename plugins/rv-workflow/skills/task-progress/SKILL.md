---
name: task-progress
description: Use to record and display milestones for explicitly tracked or medium, large, or high-risk project work. Do not use for simple questions, status or file lookups, localized routine changes, direct verification, or routine commits unless the user explicitly requests tracking.
---

# Task Progress

Use the `rv-workflow-progress` MCP tools only at meaningful phase boundaries.

- Create a task from an accepted specification or a bounded medium-sized change. Include dependency-ordered role steps and reuse a stable idempotency key.
- Mark a step when it starts, completes, becomes blocked, or reaches a user-visible milestone. Do not log individual commands.
- On revision conflict, read the latest snapshot and retry only when the intended update still preserves the accepted contract.
- For parallel agents, create independent steps with distinct `owner` values and let each agent update only its own step. Multiple `in_progress` steps are the source of truth; never infer agent lifecycle from a terminal process alone.
- Render the dashboard after task creation, when work is blocked or completed, and when the user asks for progress. Do not reopen it after every milestone.
- Before sending a final response for tracked work, read the latest snapshot and settle every runnable step. Start and complete a remaining `pending` step with evidence, finish an `in_progress` step, or skip a genuinely unnecessary step with a concrete reason. Never infer completion from an agent or terminal disappearing. Render once the task is completed or blocked.
- When repository instructions enable automatic TUI startup, use this skill at the start of every tool-using agent task only long enough to resolve the plugin root, then run `npm --prefix <plugin-root> run progress:ensure -- --color --workspace <project-root>` exactly once before any role or task classification. Panel startup is independent of tracking, so read-only and small tasks may ensure the shared watcher while remaining untracked. The npm script selects the repository-pinned Node runtime, then checks its workspace PID lease and opens a tmux, Orca, iTerm2, or macOS Terminal panel only when no live watcher exists. An ensured watcher exits after the latest workspace task has remained completed for 30 seconds. If a tracked task is created after the initial startup call, repeat the idempotent `progress:ensure` command once immediately after creation; do not rerun it at later milestones. Do not pass `--task-id`: the reusable panel follows the latest active workspace task. Use `--panel-launcher <name>` only to override incorrect detection, and do not claim that an MCP App iframe can render inside Codex TUI.
- Use terminal `--once` for a read-only single snapshot or redirected output. On a TTY, the watcher supports local navigation plus confirmed, allowlisted step mutations through the same task service; it never executes shell input. Polling and local interaction use no model calls, and background redraws occur only when the recorded revision changes.
- Keep summaries in domain language. Evidence references must be repository-relative paths or concise verification labels, never secrets, raw command output, or absolute local paths.

The dashboard reports only events recorded through these tools; do not claim that it automatically observes hidden Codex or subagent state.
