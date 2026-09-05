# Using Git Worktrees

Use only when the user explicitly requests isolation or an accepted plan requires parallel branches. Prefer an existing repository convention for worktree placement. Before creating one, confirm the destination is outside tracked paths or ignored, the target branch is correct, and the current worktree's uncommitted changes remain untouched.

Create the worktree with an explicit path and branch, install only repository-declared dependencies, activate the pinned toolchain, and run a clean baseline check. If baseline verification already fails, record the failure before implementing. Never remove a worktree containing uncommitted work without explicit confirmation; after integration, clean it up only when the selected branch workflow is complete.
