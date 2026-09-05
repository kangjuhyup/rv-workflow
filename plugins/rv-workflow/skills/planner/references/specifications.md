# Specification Guidance

Use this reference when `planner` writes a feature or technical specification.

## Required Decisions

- Problem, users and desired outcome.
- Current behavior and repository evidence.
- Scope and explicit non-goals.
- Constraints and assumptions.
- Proposed behavior, boundaries and interfaces.
- Data flow, state transitions and failure behavior.
- Security, privacy, accessibility and compatibility requirements when relevant.
- Affected areas and the implementation role for each area.
- Dependency-ordered implementation stages.
- Acceptance criteria and verification evidence.

Record decisions at the level needed to remove implementation ambiguity without prescribing incidental code structure. Distinguish requirements from examples and recommendations.

## Writing Rules

- Use consistent domain terms and repository paths.
- Resolve conflicting requirements explicitly.
- State defaults, edge cases and failure behavior.
- Link to existing contracts instead of duplicating them.
- Mark unresolved decisions as blockers and obtain an answer before finalizing the spec.
- Do not include commit, deployment or external mutation steps without matching authorization.

## Final Check

- Every in-scope behavior has an observable acceptance criterion.
- Non-goals prevent likely scope expansion.
- Interfaces agree across text, examples and diagrams.
- Implementation stages respect dependency order.
- Each stage names the appropriate `backend`, `frontend`, `document` or `qa` role.
- No unresolved marker, contradiction or unverifiable requirement remains.
