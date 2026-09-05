# Backend Testing

Use this reference to choose backend test layers and coverage. Use the `qa` skill for repository-wide execution, lint/build gates and final regression reporting.

## Select the Lowest Useful Layer

1. Domain tests for invariants, value objects and events.
2. Application tests for use-case orchestration and port interactions.
3. Adapter integration tests for mappings, queries and external contracts.
4. API or end-to-end tests for transport, wiring and critical user flows.

Do not use end-to-end tests as the only coverage for business rules. Do not mock the domain behavior being tested.

## Coverage Priorities

- Happy path plus meaningful invalid-state transitions.
- Authorization and data-isolation boundaries.
- Duplicate, retry and concurrency behavior where correctness depends on them.
- Transaction rollback and external-call failure paths.
- Projection or consumer idempotency.
- Migration compatibility for schema changes.

Use real infrastructure selectively when its semantics are part of the behavior; otherwise isolate through stable ports.

## Checks

- Each test states one observable behavior.
- Fixtures use valid domain states by default.
- Assertions verify outcomes rather than implementation trivia.
- Tests remain deterministic across order, time zone and parallel execution.
- A failure identifies the broken contract clearly.
