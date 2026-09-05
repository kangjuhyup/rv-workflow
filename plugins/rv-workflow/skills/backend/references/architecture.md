# Backend Architecture

Use this reference for layer boundaries, dependency direction, modules, ports and transaction placement.

## Boundaries

A useful default dependency direction is:

```text
delivery -> application -> domain
infrastructure -> application -> domain
```

- Domain holds business concepts and invariants without framework, transport, ORM or SDK dependencies.
- Application coordinates use cases and defines ports needed from infrastructure.
- Infrastructure implements persistence and external-service ports.
- Delivery translates transport input/output and delegates to application use cases.

Follow an existing repository's equivalent layer names when they differ. Do not introduce layers that add no boundary value.

## Transactions

- Place transaction policy at the application boundary and concrete transaction mechanics in infrastructure.
- Keep transaction scopes short and centered on authoritative persistence work.
- Do not open transactions in controllers or domain objects.
- Keep network calls, file operations, cache updates and other external I/O outside database transactions.
- For an external call followed by persistence, call the external port outside the transaction, then re-read authoritative state and save the outcome in a short transaction.
- Use database constraints and suitable isolation when correctness depends on concurrent absence, uniqueness or counts.

## Checks

- Dependency arrows point inward toward stable business rules.
- Transport DTOs do not become domain models by accident.
- Persistence entities and vendor SDK types do not cross infrastructure boundaries.
- Controllers or resolvers remain translation and delegation code.
- Module boundaries reflect business capabilities or stable technical seams.
