---
name: scoped-superpowers
description: Use when a medium, large, or high-risk project task needs narrowly selected Superpowers guidance or has independent workstreams suitable for parallel agents. Do not use for simple questions, status or file lookups, localized routine changes, direct verification, or routine commits.
---

# Scoped Superpowers Router

Use Superpowers only when its structure is worth more than its context and process overhead.

## Entry Gate

- Small, clear and low-risk: stop routing. Do not load any Superpowers skill. Use the relevant role skill and run only the direct check needed for the change.
- Medium, large or high-risk: read [scope routing](references/routing.md), choose the current phase, and load at most the one Superpowers skill selected for that phase.
- Explicit user request: use the named Superpowers skill, while preserving the user's scope and repository rules.

For medium, large and high-risk work, actively check for two or more independent workstreams that can run without shared state, overlapping edits or sequential dependencies. When the parallelism gate passes, use `dispatching-parallel-agents` and dispatch focused agents concurrently. Do not split a small task into microtasks solely to create parallel work.

Do not preload a chain of Superpowers skills. Re-evaluate only when the work enters a new phase or evidence changes its scope. Selecting no Superpowers skill is a valid outcome.

If the selected Superpowers skill is unavailable, continue with the relevant role workflow; do not install, copy, or emulate the missing skill automatically.

The user's instructions and repository-specific role skills take precedence over this router.

Task progress is separate from Superpowers selection: use `$rv-workflow:task-progress` only for explicit tracking or medium/large phase boundaries, and keep small/status/lookup/routine-commit work untracked.
