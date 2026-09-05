# CQRS

Use this reference when the codebase already separates commands and queries, or when read and write requirements materially differ.

## Write Side

- Commands express intent and mutate authoritative state.
- Validate invariants from the write model, not from eventually consistent projections.
- Return identifiers or compact outcomes rather than presentation-shaped read models.
- Persist state and publish durable event/outbox records within the same consistency boundary when required.

## Read Side

- Queries are side-effect free.
- Use projections or optimized read models when list, search or reporting needs differ from aggregate storage.
- Make projectors idempotent and observable.
- Keep read view models separate from write input models.

## Routing

- Read-only endpoints call query paths.
- Mutating endpoints call command paths.
- Controllers do not update projections or coordinate domain rules.

Do not add CQRS ceremony to straightforward CRUD without a concrete scaling, consistency or modeling benefit.

## Checks

- Command decisions use authoritative state.
- Projection lag cannot violate a business invariant.
- Projector retries do not duplicate effects.
- Query models are shaped for consumers without leaking persistence entities.
