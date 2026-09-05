---
"@rvkang/rv-workflow": patch
---

Install the pinned npm CLI directly in the release workflow instead of downloading it through Corepack, avoiding a Node Undici assertion during CI bootstrap.
