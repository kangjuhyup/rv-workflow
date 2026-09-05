import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const startScript = resolve(pluginRoot, "scripts/start-mcp.mjs");
const progressStartScript = resolve(pluginRoot, "scripts/start-progress.mjs");
const firstReleaseStartScript = resolve(pluginRoot, "scripts/start-first-release.mjs");
const legacyNode = "/usr/local/bin/node";
const expectedNodeVersion = (JSON.parse(
  readFileSync(resolve(pluginRoot, "package.json"), "utf8"),
) as { engines: { node: string } }).engines.node;

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runStartScript(
  nodePath: string,
  environment: Record<string, string | undefined>,
  entryScript = startScript,
): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(nodePath, [entryScript], {
      cwd: pluginRoot,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 2_000);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolveResult({ exitCode, signal, stdout, stderr, timedOut });
    });
  });
}

describe("MCP startup fixes its runtime before importing the server bundle", () => {
  it.skipIf(!existsSync(legacyNode))(
    "re-execs a PATH Node 16 host through RV_WORKFLOW_NODE and reports the pinned Node 24 runtime",
    async () => {
      const result = await runStartScript(legacyNode, {
        RV_WORKFLOW_NODE: process.execPath,
        RV_WORKFLOW_RUNTIME_CHECK: "1",
      });

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stdout.trim()).toBe(expectedNodeVersion);
      expect(result.stderr).toBe("");
    },
  );

  it.skipIf(!existsSync(legacyNode))(
    "fails before server import when RV_WORKFLOW_NODE is not the pinned runtime",
    async () => {
      const result = await runStartScript(legacyNode, {
        RV_WORKFLOW_NODE: "/definitely/not/a/node-binary",
        RV_WORKFLOW_RUNTIME_CHECK: "1",
      });

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/RV_WORKFLOW_NODE|Node 24\.20\.0/iu);
      expect(result.stdout).toBe("");
    },
  );

  it("allows the exact runtime to reach a safe startup probe before loading the long-running server", async () => {
    const result = await runStartScript(process.execPath, {
      RV_WORKFLOW_RUNTIME_CHECK: "1",
    });

    expect(process.versions.node).toBe(expectedNodeVersion);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(expectedNodeVersion);
    expect(result.stderr).toBe("");
  });
});

describe("Progress startup fixes its runtime before importing the CLI bundle", () => {
  it.skipIf(!existsSync(legacyNode))(
    "re-execs a PATH Node 16 host through the pinned Node 24 runtime",
    async () => {
      const result = await runStartScript(legacyNode, {
        RV_WORKFLOW_NODE: process.execPath,
        RV_WORKFLOW_RUNTIME_CHECK: "1",
      }, progressStartScript);

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stdout.trim()).toBe(expectedNodeVersion);
      expect(result.stderr).toBe("");
    },
  );
});

describe("First release startup fixes its runtime before importing release code", () => {
  it.skipIf(!existsSync(legacyNode))(
    "re-execs a PATH Node 16 host through the pinned Node 24 runtime",
    async () => {
      const result = await runStartScript(legacyNode, {
        RV_WORKFLOW_NODE: process.execPath,
        RV_WORKFLOW_RUNTIME_CHECK: "1",
      }, firstReleaseStartScript);

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stdout.trim()).toBe(expectedNodeVersion);
      expect(result.stderr).toBe("");
    },
  );
});
