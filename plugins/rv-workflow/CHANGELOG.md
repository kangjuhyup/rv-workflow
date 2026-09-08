# @rvkang/rv-workflow

## 0.2.0

### Minor Changes

- 1f53a9c: Add an automatically selected compact planning skill for natural-language planning requests, let simple tasks proceed directly without planning, and align planner profiles and routing so ordinary plans do not require a formal specification or the Superpowers planning workflow.
  
  Require user review of concrete conflicts with existing policies before affected work proceeds, including otherwise simple tasks.

## 0.1.1

### Patch Changes

- 9212334: Confirm first-release publication through the exact npm version endpoint so a newly published package can resume tag and GitHub Release creation while the package-root endpoint is still propagating.
- e522d06: Install the pinned npm CLI directly in the release workflow instead of downloading it through Corepack, avoiding a Node Undici assertion during CI bootstrap.
