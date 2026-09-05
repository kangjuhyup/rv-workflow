# Finishing a Development Branch

Before integration, run the repository's full relevant verification and inspect the resulting diff. Confirm the branch target and whether the worktree contains unrelated user changes. Never discard or overwrite work merely to make the branch clean.

Present only viable outcomes: merge locally, push and open a pull request, keep the branch for later, or discard it when the user explicitly requests deletion. For a pull request, summarize behavior and verification. For merge, update the target safely and re-run an integration check. For discard, confirm the exact branch or worktree before destructive action. Clean up temporary worktrees only after the selected integration path succeeds.
