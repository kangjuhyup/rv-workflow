---
name: scoped-superpowers
description: Use when a medium, large, or high-risk project task needs narrowly selected workflow guidance, when independent workstreams may justify parallel agents, or when the user explicitly requests a Superpowers workflow. Do not use for simple questions, status or file lookups, localized routine edits, direct verification, or routine commits.
---

# Scoped Superpowers Router

Use the bundled Superpowers-derived references only when their structure is worth more than their context and process overhead. This skill is self-contained and does not require a separately installed Superpowers plugin.

## Entry Gate

- Small, clear and low-risk: stop routing. Do not load any Superpowers skill. Use the relevant role skill and run only the direct check needed for the change.
- Medium, large or high-risk: read [scope routing](references/routing.md), choose the current phase, and load at most the one bundled workflow reference selected for that phase.
- Explicit user request: read [scope routing](references/routing.md) and load the matching bundled reference while preserving the user's scope and repository rules.

For medium, large and high-risk work, actively check for two or more independent workstreams that can run without shared state, overlapping edits or sequential dependencies. When the parallelism gate passes, use the bundled parallel-agent workflow and dispatch focused agents concurrently. Do not split a small task into microtasks solely to create parallel work.

Do not preload a chain of Superpowers skills. Re-evaluate only when the work enters a new phase or evidence changes its scope. Selecting no Superpowers skill is a valid outcome.

The user's instructions and repository-specific role skills take precedence over this router.

Task progress is separate from Superpowers selection: use `$rv-workflow:task-progress` only for explicit tracking or medium/large phase boundaries, and keep small/status/lookup/routine-commit work untracked.
