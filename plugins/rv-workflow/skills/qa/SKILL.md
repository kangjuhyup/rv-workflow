---
name: qa
description: Use when validating changes through tests, lint, type checks, builds, regression checks, code review, release gates, or focused security verification.
---

# QA Router

Read only the references needed for the requested evidence:

- Test design, authoring, selection, execution and failure reporting: [testing](references/testing.md)
- Formatter, lint, type-check and build gates: [lint and build](references/lint-build.md)
- Risk-based checks for unchanged behavior and bug fixes: [regression](references/regression.md)
- Correctness, maintainability and contract review: [review](references/review.md)
- Authentication, authorization, data exposure and dependency checks: [security](references/security.md)

Inspect repository scripts and CI configuration before choosing commands. Report the exact commands, exit status and relevant failure output. Do not claim a gate passed unless it was run in the current verification cycle.

When authoring behavior tests, treat the test suite as executable business policy. Read [testing](references/testing.md) and express rules in domain language rather than implementation terminology.

For explicitly tracked or medium/large verification, record only step starts, meaningful milestones, blocks, and completion in `$rv-workflow:task-progress`; do not track small or routine checks.
