# Lint and Build Verification

Use this reference for formatting, lint, static analysis, type-check and build gates.

## Order

Use repository conventions, typically moving from fast to expensive:

1. Format check for changed files or package.
2. Lint or static analysis.
3. Type-check or compile check.
4. Production build or packaging.

Run separate gates separately when one command does not prove the others. A passing linter does not prove compilation or production bundling.

## Scope

- Use targeted package commands during iteration.
- Use the CI-equivalent scope before final handoff when shared configuration or cross-package types changed.
- Check generated artifacts only when the repository tracks or validates them.
- Treat warnings according to repository policy; report them even when the exit code is zero if they indicate degraded output.

## Report

Record each command, exit status and whether output contained warnings. If a gate cannot run, state the exact missing dependency, service or configuration and what narrower evidence was obtained instead.
