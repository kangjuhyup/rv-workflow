---
name: document
description: Use when creating or updating README files, ERDs, implementation plans, architecture notes, existing documentation, or agent-facing repository instructions.
---

# Document Router

Read only the reference for the requested deliverable:

- Repository or package onboarding and usage: [README](references/readme.md)
- Data models, entities, relationships and constraints: [ERD](references/erd.md)
- Sequenced implementation work and verification steps: [plans](references/plans.md)
- `AGENTS.md`, skill routing and durable agent guidance: [agent docs](references/agent-docs.md)

Use `planner` when a large or ambiguous task needs a new feature or technical specification before implementation. Otherwise, inspect the code and existing documentation before writing. Prefer one maintained source of truth and link to it instead of duplicating details. Match the repository's language, terminology and document locations.

For explicitly tracked or medium/large documentation work, use `$rv-workflow:task-progress` at phase boundaries only; do not create tracking for small, status, lookup, or routine-commit work.
