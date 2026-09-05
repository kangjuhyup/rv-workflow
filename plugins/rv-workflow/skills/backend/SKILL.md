---
name: backend
description: Use when backend work involves APIs, business rules, architecture boundaries, domain models, CQRS, persistence, cache, external adapters, security, naming, or backend tests.
---

# Backend Router

Read only the references needed for the current change:

- Boundaries, dependency direction, modules, transactions: [architecture](references/architecture.md)
- Aggregates, invariants, value objects, domain events: [domain and DDD](references/domain-ddd.md)
- Commands, queries, projections, read/write separation: [CQRS](references/cqrs.md)
- Repositories, ORM, migrations, cache, external services: [adapters, persistence and cache](references/adapters-persistence-cache.md)
- Authentication, authorization, secrets, sensitive data, uploads, audit: [security](references/security.md)
- Files, types, handlers, DTOs, ports and adapters: [naming](references/naming.md)
- Backend test scope and test-layer selection: [testing](references/testing.md)

Inspect the repository's own instructions and conventions before applying a reference. Treat examples as adaptable patterns, not mandatory framework choices. If implementation also needs execution-level verification or review, use the `qa` skill after the change.

For explicitly tracked or medium/large work, use `$rv-workflow:task-progress` only at step and milestone boundaries; omit tracking for small, status, lookup, and routine-commit work.
