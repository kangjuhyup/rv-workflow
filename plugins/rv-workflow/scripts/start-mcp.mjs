#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { ensurePinnedRuntime } from "./pinned-runtime.mjs";

const scriptPath = fileURLToPath(import.meta.url);
let runtime;
try {
  runtime = await ensurePinnedRuntime({ entryPath: scriptPath, args: [], label: "rv-workflow MCP" });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

if (runtime && !runtime.reexecuted) {
  if (process.env.RV_WORKFLOW_RUNTIME_CHECK === "1") {
    process.stdout.write(`${runtime.requiredVersion}\n`);
  } else {
    const serverModuleUrl = new URL("../mcp/dist/server.js", import.meta.url);
    const { startMcpServer } = await import(serverModuleUrl.href);
    await startMcpServer().catch((error) => {
      console.error("rv-workflow MCP server failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
