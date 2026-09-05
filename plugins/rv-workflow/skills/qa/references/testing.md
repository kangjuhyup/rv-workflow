# QA Testing

Use this reference to select and run tests for a change.

## Tests as Executable Business Policy

For business rules and user-visible behavior, write tests so the suite can be read as the current business policy document:

- Name the test group after the policy or capability and each test after an observable business scenario.
- Make the actor or context, precondition, action and expected outcome clear through the test name and Given/When/Then or equivalent structure.
- Use domain terms from the accepted specification and public contracts. Avoid method names, database details and framework terminology unless those details are themselves part of the contract.
- Cover the permitted path, rejected path, policy boundaries and material exceptions. Prefer one policy outcome per test; use parameterized cases when several inputs express the same rule.
- Keep technical setup behind fixtures, builders or helpers when it obscures the policy. Assertions should emphasize externally observable results and meaningful domain state.
- Preserve traceability to the relevant specification heading, rule identifier or decision when one exists. Add comments only to explain business rationale or a non-obvious policy source, not test mechanics.
- A failing test should identify which policy was violated. Replace vague names such as `works` or `returns error` with the rule and expected outcome.

Do not force business language onto low-level tests whose subject is purely technical, such as serialization, adapter wiring or performance characteristics. Those tests should still state their technical contract precisely.

## Selection

- Start with the smallest test target that exercises the changed behavior.
- Expand to affected package or module tests.
- Run repository-wide tests when shared contracts, configuration or critical paths changed and the cost is reasonable.
- Include integration or end-to-end coverage when the change crosses process, persistence, transport or browser boundaries.

Derive commands from package scripts, task runners and CI. Do not invent flags that bypass repository configuration.

## Failure Handling

- Distinguish a product failure from environment, fixture or infrastructure failure.
- Capture the first actionable error and reproduce it with the narrowest command.
- Use `systematic-debugging` when the cause is unclear, behavior is flaky or failures cascade.
- Do not silently update snapshots or expected outputs without confirming the behavior change is intended.

## Report

- Command and scope.
- Pass, fail or not run.
- Counts when available.
- Relevant failure reason and affected test.
- Any coverage gap or environmental limitation.
