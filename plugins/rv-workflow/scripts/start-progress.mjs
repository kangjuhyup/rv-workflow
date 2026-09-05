#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { ensurePinnedRuntime } from "./pinned-runtime.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
let runtime;
try {
  runtime = await ensurePinnedRuntime({ entryPath: scriptPath, args, label: "rv-workflow progress CLI" });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

if (runtime && !runtime.reexecuted) {
  if (process.env.RV_WORKFLOW_RUNTIME_CHECK === "1") {
    process.stdout.write(`${runtime.requiredVersion}\n`);
  } else {
    const cliModuleUrl = new URL("../mcp/dist/progress-cli.js", import.meta.url);
    const { runProgressCli } = await import(cliModuleUrl.href);
    process.exitCode = await runProgressCli({ argv: args });
  }
}
