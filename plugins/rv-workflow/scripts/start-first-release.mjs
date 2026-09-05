#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { ensurePinnedRuntime } from "./pinned-runtime.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

try {
  const runtime = await ensurePinnedRuntime({
    entryPath: scriptPath,
    args,
    label: "rv-workflow first release",
  });

  if (!runtime.reexecuted) {
    if (process.env.RV_WORKFLOW_RUNTIME_CHECK === "1") {
      process.stdout.write(`${runtime.requiredVersion}\n`);
    } else {
      const { runFirstReleaseCli } = await import("./first-release.mjs");
      await runFirstReleaseCli({ argv: args });
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
