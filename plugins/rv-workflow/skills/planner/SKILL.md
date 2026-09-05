---
name: planner
description: Use when a large, ambiguous, or cross-role change needs an evidence-backed feature or technical specification before implementation.
---

# Planner

Create the specification document before implementation:

1. Inspect repository instructions, architecture, current behavior, affected files and verification commands.
2. Resolve material product or technical ambiguities with the user; do not invent decisions.
3. Read [specification guidance](references/specifications.md) and write the spec at the repository's established location. If none exists, use `docs/specs/YYYY-MM-DD-<topic>.md`.
4. Identify the implementation roles and dependency order without duplicating their detailed rules.
5. Check the written spec for missing decisions, contradictions, unresolved markers and unverifiable acceptance criteria.

Stop after the specification is written and report its path. Implementation starts only after the user accepts the spec. Then use the selected `backend`, `frontend` or `document` roles, followed by `qa`.

Do not invoke Superpowers merely because this skill writes a specification. Follow the repository's Superpowers allow-list and explicit-use policy.

For large/high-risk work, create the tracked task and dependency-ordered steps at the implementation boundary after the specification is accepted. Do not track the planning conversation itself unless the user explicitly requests progress tracking.
