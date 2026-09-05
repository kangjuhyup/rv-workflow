# Plan Guidance

Use this reference when the requested deliverable is an implementation or migration plan. If requirements or architectural decisions are unresolved, use `planner` to create the specification first.

## Plan Shape

- State the outcome and constraints.
- List exact files or areas after inspecting the repository.
- Break work into dependency-ordered, independently verifiable stages.
- For each stage, name the implementation role, expected change and verification evidence.
- Put risky migrations, compatibility steps and rollback decisions before dependent rollout work.
- End with repository-wide regression and documentation updates.

Steps should be concrete enough to execute without rediscovering architecture, but avoid speculative code that cannot be confirmed from the repository.

## Checks

- Every requirement maps to at least one step.
- Dependencies and decision gates are explicit.
- Verification follows the change it proves.
- The plan does not require unavailable tools or unexplained permissions.
- No unfinished marker, vague “handle edge cases,” or “test as needed” steps remain.
