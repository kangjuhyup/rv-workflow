# @rvkang/rv-workflow

## 0.1.1

### Patch Changes

- 9212334: Confirm first-release publication through the exact npm version endpoint so a newly published package can resume tag and GitHub Release creation while the package-root endpoint is still propagating.
- e522d06: Install the pinned npm CLI directly in the release workflow instead of downloading it through Corepack, avoiding a Node Undici assertion during CI bootstrap.
