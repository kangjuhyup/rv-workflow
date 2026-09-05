# Domain and DDD

Use this reference when business invariants, aggregates, value objects, domain events or multi-step domain workflows are changing.

## Model the Domain

- Name concepts in the domain's language rather than transport or database terms.
- Put invariants on the object or service that has enough authoritative information to enforce them.
- Use value objects for concepts whose validation and equality matter.
- Keep aggregate boundaries small enough to update atomically.
- Prefer one aggregate mutation per command when practical.
- Emit past-tense domain events for meaningful completed state changes.

Do not force DDD patterns onto simple CRUD. Add an aggregate, event or domain service only when it protects a real rule or boundary.

## Cross-Boundary Workflows

Use an application orchestrator or persisted process manager when a workflow spans aggregates or external systems. Long-running workflows should make progress explicit, support retries and tolerate duplicate delivery.

External side effects remain behind ports. Persist enough state to resume or reconcile the workflow without depending on in-memory execution.

## Checks

- Invariants cannot be bypassed through public mutation APIs.
- Aggregate state changes are atomic within the chosen consistency boundary.
- Events describe business facts, not implementation calls.
- Mutable values needed for historical decisions are snapshotted when the decision occurs.
- Sensitive vendor payloads and framework types remain outside domain code.
