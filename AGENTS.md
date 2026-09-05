# AGENTS.md

## TUI Startup

At the start of every tool-using agent task, including read-only inspection, status checks, and small tasks, invoke `$rv-workflow:task-progress` only long enough to resolve its installed plugin root, then run `npm --prefix <plugin-root> run progress:ensure -- --color --workspace <project-root>` exactly once before any role or task classification. This startup rule is independent of whether the work is tracked. The npm script selects the repository-pinned Node runtime, reuses a live workspace watcher, and opens an Orca, tmux, iTerm2, or macOS Terminal panel only when one is absent. An ensured watcher exits after the workspace has remained on completed work for 30 seconds. If a tracked task is created after the initial startup call, run the same `progress:ensure` command once immediately after creation so slow classification cannot leave that task without a panel. Do not pass `--task-id`; the reusable panel follows the latest active task. Pure conversational responses that require no tools do not launch the panel.

## Role Skills

Choose the smallest role skill that covers the current task. Load only the references that the role router selects.

| Role | Use for |
| --- | --- |
| `backend` | APIs, domain logic, architecture, persistence, cache, security, backend naming and tests |
| `frontend` | UI structure, React/Next.js, components, design systems, UX and accessibility |
| `document` | README, ERD, implementation plans and agent-facing documentation |
| `qa` | Test execution, lint/build checks, regression verification, review and security checks |
| `planner` | Evidence-backed specification documents for large, ambiguous or cross-role work |

For a focused task, start with its implementation role. Use `planner` first when the work needs a specification because it spans several files or roles, has unclear boundaries, or contains unresolved product or technical decisions. After the specification is accepted, use the selected implementation roles and then `qa` for verification or review.

Do not load every role or every reference preemptively. When several references apply, read the minimum set needed for the current decision.

## Project Toolchain Gate

Before editing implementation or test code, running project commands, or producing generated artifacts, every agent must use `project-toolchain` to resolve, activate and verify the task-relevant language runtime, framework or engine, build tool and package manager versions.

- Derive versions from repository instructions, module-specific pins, engine metadata, wrappers, manifests, containers and CI. Do not guess or select the newest version.
- Prefer repository wrappers and existing project version managers. Do not change pinned versions, manifests or lockfiles unless the assigned task explicitly requires an upgrade.
- Verify the active versions before implementation, testing, builds, validation or generators, and include concise version evidence in the handoff.
- Read-only, status and prose-only work with no executable dependency uses the skill's not-applicable fast path.
- Every parallel agent performs the gate in its assigned module; the coordinating agent checks toolchain compatibility before integrating results.

## Role Models

Skills do not switch models by themselves. Matching Codex custom-agent profiles under `.codex/agents` provide the executable model routing:

| Role | Model | Reasoning |
| --- | --- | --- |
| `backend` | `gpt-5.6-sol` | `high` |
| `frontend` | `gpt-5.6-sol` | `medium` |
| `document` | `gpt-5.6-luna` | `medium` |
| `qa` | `gpt-5.6-terra` | `high` |
| `planner` | `gpt-5.6-sol` | `high` |
| `test-writer` (supporting agent) | `gpt-5.6-terra` | `high` |

Use the same-named custom agent when role-specific model routing is required. Direct skill invocation continues on the current session model. When the `rv-workflow` plugin is installed, invoke its skills with plugin-qualified names such as `$rv-workflow:backend` and `$rv-workflow:task-progress` to avoid collisions with unrelated skills.

For specification-driven feature work, use this handoff sequence:

1. `planner` writes the specification and waits for acceptance.
2. `test-writer` converts the accepted behavior and public contracts into focused failing tests that read as an executable business policy document. It uses `qa` as its primary skill and reads `backend` or `frontend` guidance only when test placement or framework conventions require it.
3. `backend` and/or `frontend` implement production code against the accepted specification and tests.
4. A fresh `qa` agent independently runs the relevant test, lint, type-check, build, regression, review, and security gates.

`test-writer` is a supporting custom agent, not a sixth role skill. It must not modify production code. Implementation agents must not weaken or rewrite tests merely to make them pass; they must report a concrete specification or contract mismatch before proposing any test change.

## Task Progress Policy

Use `rv-workflow:task-progress` only at meaningful phase boundaries for explicitly tracked or medium/large work: create the task/step, start a step, record a major milestone, block and reason, complete/skip a step, and complete the task. Do not create tracking for small questions, status checks, file lookups, localized routine edits, or routine commits. The dashboard is read-only; agents remain the source of truth through explicit MCP writes.

For medium, large or high-risk work, invoke `$rv-workflow:task-progress` automatically even when the user does not name the workflow. Immediately after creating the tracked task, repeat the idempotent `--ensure-panel` command from `TUI Startup`; do not rerun it at later milestones.

For parallel agents, create independent role steps with distinct `owner` values. Each agent updates only its assigned step at major boundaries. Multiple `in_progress` steps represent concurrent work; on a revision conflict, read the latest snapshot and retry only the still-valid update. Do not infer completion from terminal or agent-process presence.

Before sending a final response for tracked work, the coordinating agent must read the latest task snapshot. It must not leave a runnable step `pending` or `in_progress`: start and complete the step with evidence, or skip it with a concrete reason when it is genuinely unnecessary. Never infer step completion from an agent or terminal disappearing. Render the dashboard once the task is completed or blocked so the final recorded state is visible.

## Superpowers Usage Policy

Classify Superpowers usage by task scope before loading any Superpowers skill:

- Small, clear and low-risk work: do not invoke `scoped-superpowers` or any Superpowers skill. This includes simple questions, status checks, small explanations, direct shell-output requests, straightforward file lookups, localized routine edits and routine commits. Use the relevant role skill and a direct, proportional check.
- Medium, large or high-risk work: invoke `rv-workflow:scoped-superpowers` as the lightweight decision gate. Load only the Superpowers skill selected for the current phase; never preload the whole workflow.
- Explicitly requested Superpowers workflow: use the named skill without expanding the user's requested scope.

Scope is determined primarily by uncertainty, blast radius, reversibility and security or data risk, not by file count alone. Any high-risk concern promotes the task regardless of apparent size.

For medium, large and high-risk work, actively use parallel agents when there are at least two concrete workstreams with no shared mutable state, overlapping file edits or sequential dependency, and each workstream is substantial enough to justify dispatch. Use `dispatching-parallel-agents`, start eligible agents concurrently, give each a focused scope and expected evidence, then review and verify the integrated result. Do not split small work or related failures merely to create parallelism.

`brainstorming`, `test-driven-development`, `executing-plans`, `using-git-worktrees`, `finishing-a-development-branch`, `subagent-driven-development`, `writing-skills` and `using-superpowers` remain explicit-request-only. Do not use `using-superpowers` as a default turn starter.

Repository-specific instructions and direct user requests take precedence over this routing policy.
