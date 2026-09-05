# Agent Documentation

Use this reference for `AGENTS.md`, `CLAUDE.md`, skill entrypoints and other durable instructions for coding agents.

## Scope Instructions

- Put repository-wide policy at the repository root.
- Put narrower instructions close to the subtree they govern.
- State which instruction wins when scopes overlap.
- Keep project facts and non-obvious constraints; omit generic coding advice the agent already knows.
- Do not imply authorization for commits, deployments or external mutations.

## Skill Routing

- Make frontmatter descriptions discriminate by trigger rather than summarize the workflow.
- Keep entry skills short and route conditional detail to one-level-deep references.
- Tell the agent when each reference is needed.
- Avoid requiring every reference for every task.
- Reference another installed skill by name when the workflow truly requires it; do not hard-code environment-specific installation paths.

## Checks

- Instructions are current, scoped and internally consistent.
- Relative links resolve from the file containing them.
- Required behavior is distinguishable from optional guidance.
- No repository-specific secret, user path or transient incident became a universal rule.
- Frontmatter names match their skill directories.
