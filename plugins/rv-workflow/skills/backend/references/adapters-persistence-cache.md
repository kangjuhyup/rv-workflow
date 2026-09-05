# Adapters, Persistence and Cache

Use this reference for repositories, ORM entities, migrations, cache, files, queues and third-party service adapters.

## Persistence

- Treat the configured authoritative store as the source of truth.
- Keep ORM entities and migration details in infrastructure.
- Map explicitly between persistence records, domain models and read models.
- Define ports around application needs rather than mirroring vendor SDK APIs.
- Make migrations reversible when practical and safe to roll forward when rollback would lose data.

## Cache

Use cache as an optimization unless the feature explicitly defines it as authoritative:

```text
write: authoritative store -> commit -> invalidate or update cache
read: cache miss -> authoritative store -> populate cache
```

Cache failures should not corrupt authoritative writes. Never cache secrets, one-time credentials or sensitive raw payloads without an explicit threat-model decision.

## External Adapters

- Keep storage, identity, payment, messaging and other SDKs behind ports.
- Do not hold database transactions open during network or binary I/O.
- Persist request, status and provider identifiers needed for audit, retry and reconciliation.
- Make retry behavior idempotent or use idempotency keys.
- Translate vendor errors into stable application-level errors at the adapter boundary.

## Checks

- Infrastructure types do not leak into application or domain code.
- Cache invalidation follows successful authoritative writes.
- External outcomes can be retried or reconciled.
- Failure paths preserve enough state for diagnosis without logging secrets.
