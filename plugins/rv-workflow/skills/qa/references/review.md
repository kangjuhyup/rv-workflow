# Code Review

Use this reference for correctness, maintainability and contract review after understanding the requested change.

## Review Order

1. Compare the diff with the stated requirements and repository instructions.
2. Trace changed behavior through callers, boundaries and failure paths.
3. Check data, concurrency, authorization and compatibility risks.
4. Check tests for meaningful coverage and false confidence.
5. Check readability, naming and unnecessary complexity.

Prioritize findings by user impact and likelihood. Lead with concrete defects, regressions or missing verification rather than stylistic preference.

## Finding Format

For each finding include:

- Severity and precise file/line location.
- The scenario that triggers the problem.
- The observable impact.
- Why existing safeguards or tests do not prevent it.
- A focused correction when it is not obvious.

If no findings remain, say so and identify residual risks or verification gaps. Do not treat “no findings” as proof that the code is correct.
