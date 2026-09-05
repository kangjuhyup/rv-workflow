# QA Security Checks

Use this reference for focused security verification of a change. It complements, rather than replaces, threat modeling or a specialist audit.

## Inspect

- Authentication and session changes.
- Resource-level authorization and tenant isolation.
- Input validation, parsing and output encoding.
- Secret handling, logs, errors and telemetry.
- Data retention, export and deletion behavior.
- File uploads, redirects, URLs and external callbacks.
- Dependency, configuration and permission changes.
- Replay, duplication, race and rate-limit behavior where relevant.

## Verify

- Test both permitted and denied access with realistic identities.
- Attempt cross-user or cross-tenant resource access.
- Check that failures do not disclose sensitive data.
- Confirm secure defaults when configuration is missing or malformed.
- Use the repository's dependency or secret scanners when available.
- Review generated client bundles or artifacts for server-only values after frontend boundary changes.

Report exploitable scenarios and evidence. Avoid overstating automated scanner output without confirming reachability and impact.
