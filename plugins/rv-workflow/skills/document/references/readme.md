# README Guidance

Use this reference for repository, package or service README files.

## Reader Contract

A README should help its intended reader answer:

1. What is this and who is it for?
2. What prerequisites are required?
3. How do I install, configure and run it?
4. How do I verify it works?
5. Where do I go for deeper architecture, operations or contribution guidance?

## Content

- Derive commands, paths, versions and environment variables from the repository.
- Mark required and optional configuration clearly without including secret values.
- Use the shortest working example that reaches a meaningful result.
- Separate local development, testing, build and deployment commands when they differ.
- Link to detailed specifications or runbooks rather than copying them.

## Checks

- Commands run from the documented directory.
- File paths and links resolve.
- New contributors can identify the default workflow.
- Examples match current public APIs and configuration names.
- No credentials, internal-only URLs or stale badges are present.
