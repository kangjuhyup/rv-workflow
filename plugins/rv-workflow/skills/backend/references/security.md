# Backend Security

Use this reference for authentication, authorization, identity, secrets, sensitive data, uploads, externally supplied input or audit-sensitive behavior.

## Trust Boundaries

- Validate and normalize data at the boundary where untrusted input enters.
- Authenticate identity, then authorize the specific action and resource.
- Enforce authorization server-side even when the UI hides unavailable actions.
- Derive privileged values from trusted state rather than client input.
- Prefer deny-by-default policy for new roles, resources and actions.

## Sensitive Data

- Store only what the feature needs and define retention expectations.
- Use appropriate one-way hashing for lookup-only sensitive identifiers and password-specific hashing for passwords.
- Encrypt secrets and confidential values at rest when reversible access is required.
- Do not log tokens, credentials, private keys, raw identity payloads or sensitive file contents.
- Redact error responses and observability fields at trust boundaries.

## Operations

- Validate upload type, size, name and storage destination; use opaque storage keys.
- Protect mutation endpoints against replay, duplication and concurrency races where relevant.
- Keep security-relevant audit records useful without including secrets.
- Use parameterized queries and safe serialization APIs.
- Apply rate limits, expiration and revocation to credentials or verification challenges as appropriate.

## Checks

- Threats at each external boundary have an explicit control.
- Authorization is tested for permitted and denied cases.
- Logs and errors do not expose sensitive values.
- Database constraints backstop uniqueness or replay invariants.
- Dependency or configuration changes do not weaken secure defaults.
