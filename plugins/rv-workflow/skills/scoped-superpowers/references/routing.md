# Scope Routing

The workflow references below are adapted from Superpowers 6.3.0 and bundled with RV Workflow. Read only the one reference selected for the current phase.

Classify work by uncertainty, blast radius, reversibility and operational risk. File count is supporting evidence, not the deciding rule. Any meaningful authentication, authorization, sensitive-data, destructive-migration or production risk promotes the task to high-risk.

## Scope Classes

### Small

The expected behavior and edit are obvious, localized and easily reversible. Examples include questions, status checks, file inspection, wording changes, a narrow configuration edit, an obvious typo or a routine commit with no unresolved failure.

- Use no bundled workflow reference.
- Apply the relevant role skill directly.
- Verify with the smallest meaningful command or inspection; do not create a plan, test suite, review cycle or worktree solely for process compliance.

### Medium

The task is bounded to one main role or subsystem but changes behavior, spans several related edits, needs focused tests, or has a non-obvious failure.

- Load at most one bundled workflow reference for the current phase.
- Prefer direct implementation when the accepted behavior and sequence are already clear.
- Actively parallelize independent investigation, implementation or verification lanes when the parallelism gate below passes.
- Move to another workflow reference only after the current phase ends and the next phase independently meets its trigger.

### Large or High-Risk

The task crosses roles or architectural boundaries, changes public contracts, involves a migration or sensitive controls, has broad regression potential, or still contains material product or technical uncertainty.

- Use `planner` first when a specification or cross-role sequence is needed.
- After the specification is accepted, choose only the bundled workflow required by the active phase.
- Dispatch independent role or subsystem work concurrently after contracts and ownership boundaries are clear.
- Do not automatically combine brainstorming, planning, worktrees, TDD, delegation, review and verification into one workflow.

## Parallelism Gate

Use [dispatching parallel agents](superpowers/dispatching-parallel-agents.md) proactively when all of the following are true:

- There are at least two concrete workstreams with distinct goals.
- Each workstream can be understood from a focused, self-contained assignment.
- The workstreams do not require the same files, mutable state or exclusive external resource.
- No workstream needs another workstream's unfinished result before it can proceed.
- Each workstream contains enough investigation, implementation or verification work to outweigh dispatch and integration overhead.

Dispatch one agent per independent problem domain or role, up to the available concurrency. Start eligible agents together rather than waiting for each result sequentially. Give each agent a specific goal, file or subsystem scope, constraints, expected evidence and handoff format.

The coordinating agent retains ownership of cross-cutting decisions, reviews every result, checks for overlapping edits or conflicting assumptions, and runs the integrated verification. Continue useful non-overlapping coordinator work while agents run.

Do not dispatch parallel agents for microtasks, related failures that may share one root cause, exploratory work whose domains are not yet known, changes to the same files, or work with a real dependency chain. Establish the shared contract first, then parallelize downstream work.

## Phase Routing

| Current evidence or phase | Superpowers decision |
| --- | --- |
| Requirements are already clear | Skip [brainstorming](superpowers/brainstorming.md). Use `planner` only if a project specification is needed. |
| Implementation order needs a reviewable sequence | Use `$rv-workflow:compact-plan`; do not load a bundled planning workflow unless the user explicitly requests it. |
| Two or more workstreams pass the parallelism gate | Read [dispatching parallel agents](superpowers/dispatching-parallel-agents.md) and start focused agents concurrently. |
| A real bug or failure has an unclear cause, is flaky, or produces cascading symptoms | Read [systematic debugging](superpowers/systematic-debugging.md). Skip it for an obvious typo or a directly explained failure. |
| Substantive or questionable review feedback must be evaluated | Read [receiving code review](superpowers/receiving-code-review.md). Skip it for mechanical, unambiguous edits. |
| A broad or risky implementation needs an additional review gate | Read [requesting code review](superpowers/requesting-code-review.md). Skip it for localized routine changes. |
| A medium, large or high-risk change is ready for a completion claim | Read [verification before completion](superpowers/verification-before-completion.md) once and obtain fresh, scope-appropriate evidence. For small changes, run the direct check without loading this workflow. |

Use the following only when the user explicitly requests that workflow:

- [brainstorming](superpowers/brainstorming.md)
- [test-driven development](superpowers/test-driven-development.md)
- [writing plans](superpowers/writing-plans.md)
- [executing plans](superpowers/executing-plans.md)
- [using Git worktrees](superpowers/using-git-worktrees.md)
- [finishing a development branch](superpowers/finishing-a-development-branch.md)
- [subagent-driven development](superpowers/subagent-driven-development.md)
- [writing skills](superpowers/writing-skills.md)
- [using the bundled workflows](superpowers/using-superpowers.md)

## Overhead Limits

- Read only the selected bundled reference; do not preload the workflow catalog.
- Do not load [using the bundled workflows](superpowers/using-superpowers.md) as a conversation starter or discovery step.
- Do not create extra documents, worktrees, checkpoints or review passes unless the selected workflow and current scope require them. Create subagents when the parallelism gate passes; otherwise keep the work local.
- Do not repeat a passing verification command without new changes, a failure, or an unresolved risk.
- If a selected workflow starts expanding beyond the user's requested outcome, stop that workflow and return to the relevant role skill.
