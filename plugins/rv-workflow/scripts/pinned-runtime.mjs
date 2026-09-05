import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function requiredNodeVersion(pluginRoot) {
  const packageManifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
  return packageManifest.engines.node;
}

function reportsRequiredVersion(candidate, requiredVersion) {
  if (!candidate || !existsSync(candidate)) return false;
  const result = spawnSync(candidate, ["-p", "process.versions.node"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  });
  return result.status === 0 && result.stdout.trim() === requiredVersion;
}

function runtimeCandidates(requiredVersion) {
  const userHome = homedir();
  return [
    process.env.NVM_BIN && join(process.env.NVM_BIN, "node"),
    join(userHome, ".nvm", "versions", "node", `v${requiredVersion}`, "bin", "node"),
    join(process.env.ASDF_DATA_DIR ?? join(userHome, ".asdf"), "installs", "nodejs", requiredVersion, "bin", "node"),
    join(process.env.MISE_DATA_DIR ?? join(userHome, ".local", "share", "mise"), "installs", "node", requiredVersion, "bin", "node"),
    join(userHome, ".volta", "tools", "image", "node", requiredVersion, "bin", "node"),
  ].filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index);
}

async function reexec(nodePath, entryPath, args) {
  const child = spawn(nodePath, [entryPath, ...args], {
    env: { ...process.env, RV_WORKFLOW_NODE: nodePath },
    stdio: "inherit",
  });
  const forward = (signal) => child.kill(signal);
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.off("SIGINT", forward);
  process.off("SIGTERM", forward);
  process.exitCode = exitCode;
}

export async function ensurePinnedRuntime({ entryPath, args, label }) {
  const pluginRoot = dirname(dirname(entryPath));
  const requiredVersion = requiredNodeVersion(pluginRoot);
  if (process.versions.node === requiredVersion) return { reexecuted: false, requiredVersion };

  const configuredNode = process.env.RV_WORKFLOW_NODE;
  if (configuredNode !== undefined && !reportsRequiredVersion(configuredNode, requiredVersion)) {
    throw new Error(`RV_WORKFLOW_NODE must point to Node ${requiredVersion}.`);
  }
  const pinnedNode = configuredNode
    ?? runtimeCandidates(requiredVersion).find((candidate) => reportsRequiredVersion(candidate, requiredVersion));
  if (pinnedNode === undefined) {
    throw new Error(`${label} requires Node ${requiredVersion}. Install it or set RV_WORKFLOW_NODE to its executable.`);
  }

  await reexec(pinnedNode, entryPath, args);
  return { reexecuted: true, requiredVersion };
}
