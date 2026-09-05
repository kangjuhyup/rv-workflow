# Regression Verification

Use this reference after bug fixes, refactors, dependency changes, migrations or shared-contract changes.

## Build a Risk Map

Identify:

- The original symptom or behavior being changed.
- Direct callers and consumers.
- Shared types, schemas, configuration and persisted data touched.
- Compatibility boundaries such as APIs, events, files or browser behavior.
- Failure paths and adjacent user flows likely to share the cause.

## Verify

- Reproduce the original symptom before the fix when a safe reproducible case exists.
- Verify the corrected behavior with the same case.
- Run focused tests for direct dependencies and consumers.
- Check backwards compatibility or document the intentional break.
- For migrations, verify both existing and newly created data paths.
- For UI changes, check responsive, keyboard and state variants affected by the change.

Do not equate broad test counts with coverage of the original risk. Report what specific regression each command or manual check proves.
