# Requesting Code Review

Request review when a broad or risky implementation needs an independent correctness pass. Define the review range with an explicit base and head, summarize the accepted behavior, identify high-risk areas, and provide the relevant test evidence. Ask the reviewer to find concrete defects, regressions, security issues, and contract mismatches rather than to rewrite the design by preference.

Triage findings by severity. Verify each finding against the code before changing it, fix confirmed critical or important issues, and run focused checks. If a fix changes the review range materially, request one scoped re-review. A reviewer saying “looks good” is not a substitute for the coordinator's final verification.
