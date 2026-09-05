# ERD Guidance

Use this reference for entity-relationship diagrams and data-model documentation.

## Include

- Entity names using the domain vocabulary.
- Primary keys, foreign keys and relationship cardinality.
- Nullability, uniqueness and important check constraints.
- Join entities and ownership or lifecycle rules.
- Indexes that enforce correctness or support critical access paths.
- Sensitive-data classification when it changes handling expectations.

Separate conceptual relationships from physical storage details when both audiences need documentation. Explain denormalization, polymorphic associations or eventual-consistency boundaries rather than leaving them implicit.

## Source of Truth

Compare diagrams with schema definitions and migrations. When they disagree, identify the authoritative source and update the stale artifact rather than guessing.

## Checks

- Every relationship has direction and cardinality.
- Optionality matches database nullability and application behavior.
- Unique constraints reflect identity and duplicate-prevention rules.
- Names match code and migrations.
- The diagram does not expose real production data or secrets.
