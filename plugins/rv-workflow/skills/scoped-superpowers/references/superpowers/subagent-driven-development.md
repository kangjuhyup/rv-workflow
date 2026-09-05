# Subagent-Driven Development

Use only when the user explicitly requests this workflow and the implementation plan has separable tasks. Give each task a fresh agent with exclusive file ownership, the full task contract, repository constraints, and required evidence. Record the base revision before work starts so later review covers the entire task rather than only its last commit.

After implementation, run two gates: first verify specification compliance, then review code quality and regression risk. Send confirmed findings back for one focused correction and scoped re-review. Do not let implementation agents change accepted tests to obtain green results. The coordinator owns shared decisions, integrates results, and runs the final repository-wide checks.
