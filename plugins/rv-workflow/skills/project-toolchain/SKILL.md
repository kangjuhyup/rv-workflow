---
name: project-toolchain
description: Use before implementation, test, build, validation, or generated-artifact work to resolve, activate, and verify the repository-pinned language runtime, framework or engine, build tool, and package manager versions relevant to the task. Use the no-op path for read-only, status, or prose-only work with no executable toolchain dependency.
---

# Project Toolchain Gate

Establish the task's executable environment before editing files or running project commands.

## Fast Path

- Read-only inspection, status reporting, or prose-only documentation with no generated output: record the toolchain as not applicable and stop.
- An obvious single toolchain with authoritative repository pins: resolve it directly and do not read extra guidance.
- Multiple stacks, nested modules, conflicting declarations, or an unfamiliar engine: read [version sources and activation](references/version-sources.md).

## Resolve and Activate

1. Identify only the language runtime, framework or engine, build tool, package manager and service versions required by the assigned task.
2. Resolve versions from repository instructions and machine-readable pins. Prefer the nearest module-specific declaration or wrapper over a broad workspace default. Do not guess or choose the newest version.
3. Activate the declared versions with the repository's existing version manager, wrapper or documented bootstrap path.
4. Run the narrow version commands that prove the active environment matches the resolved versions before implementation, tests, builds or generators.
5. Keep a concise record of the version, source file and observed command output for the agent handoff.

## Boundaries

- Do not modify version pins, manifests or lockfiles merely to match the current machine. Version upgrades require an explicit task.
- Do not use `sudo` or install a system-global runtime. Prefer an already configured project version manager and project-local dependencies.
- If a pinned version is missing, use the repository's documented non-global bootstrap when it is part of the assigned executable work. Otherwise report the missing prerequisite before running with a different version.
- Treat conflicts between repository declarations as a blocker to executable work until the most specific authoritative source can be established; report the conflicting files and values.
- Each parallel agent performs this gate in its own assigned module or working directory. The coordinating agent checks that handoffs used compatible toolchains before integration.

User instructions and repository-specific setup documentation take precedence over this generic gate.

This gate is a no-op for read-only inspection and prose-only documentation. For tracked or medium/large executable work, pair the resolved gate with `$rv-workflow:task-progress` boundary updates; never add tracking overhead to small or routine work.
