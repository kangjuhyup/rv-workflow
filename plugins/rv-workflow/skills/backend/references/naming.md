# Backend Naming

Use this reference when introducing or renaming files, modules, DTOs, use cases, ports, adapters, domain objects or events.

## Principles

- Prefer the repository's established vocabulary and filename convention.
- Name by responsibility and domain meaning, not by implementation accident.
- Keep transport input, application intent, domain state and provider payload names distinct.
- Use verbs for actions and nouns for stable concepts.
- Give domain events past-tense names that describe completed facts.

## Useful Suffixes

Use these only when they match the repository's architecture:

| Role | Examples |
| --- | --- |
| Transport | `Request`, `Response`, `Body`, `Query`, `Param` |
| Application | `Command`, `Query`, `Handler`, `UseCase`, `View` |
| Domain | `Aggregate`, `Policy`, `Specification`, `Error` |
| Boundary | `Port`, `Repository`, `Gateway` |
| Infrastructure | `Adapter`, `Entity`, `Payload`, `Result` |

Avoid generic names such as `Manager`, `Helper`, `Utils`, `Data` or `Common` when a narrower responsibility exists.

## Checks

- File and exported type names agree.
- A name communicates its architectural role without opening the file.
- Provider-specific language stays at the provider boundary.
- Renames update tests, imports, documentation and serialized contracts deliberately.
