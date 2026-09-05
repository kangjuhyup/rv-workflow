#!/usr/bin/env node

import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDirectory, "..");
const execFileAsync = promisify(execFile);

const templates = [
  ["templates/AGENTS.md.fragment", "AGENTS.md"],
  ["templates/.codex/config.toml.fragment", ".codex/config.toml"],
  ["templates/.codex/agents/backend.toml", ".codex/agents/backend.toml"],
  ["templates/.codex/agents/document.toml", ".codex/agents/document.toml"],
  ["templates/.codex/agents/frontend.toml", ".codex/agents/frontend.toml"],
  ["templates/.codex/agents/planner.toml", ".codex/agents/planner.toml"],
  ["templates/.codex/agents/qa.toml", ".codex/agents/qa.toml"],
  ["templates/.codex/agents/test-writer.toml", ".codex/agents/test-writer.toml"],
];

function usage() {
  return "Usage: node scripts/install-templates.mjs <target-project-path> [--apply]";
}

async function pathKind(path) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return "symbolic link";
    if (stat.isDirectory()) return "directory";
    return "file";
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function findUnsafeParent(targetRoot, destination) {
  let cursor = dirname(destination);
  while (cursor !== targetRoot) {
    const kind = await pathKind(cursor);
    if (kind === "symbolic link" || kind === "file") return { path: cursor, kind };
    const parent = dirname(cursor);
    if (parent === cursor || relative(targetRoot, parent).startsWith("..")) {
      return { path: cursor, kind: kind ?? "path outside target" };
    }
    cursor = parent;
  }
  return null;
}

function injectedPluginStatus() {
  const injected = process.env.RV_WORKFLOW_PLUGIN_STATUS;
  if (injected === undefined) return null;
  if (["installed", "not-installed", "unavailable", "unknown"].includes(injected)) return injected;
  return "unknown";
}

function containsInstalledPlugin(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.installed)) return null;
  return value.installed.some((plugin) =>
    plugin &&
    typeof plugin === "object" &&
    (plugin.name === "rv-workflow" ||
      plugin.pluginId === "rv-workflow" ||
      (typeof plugin.pluginId === "string" && plugin.pluginId.startsWith("rv-workflow@"))) &&
    plugin.installed !== false
  );
}

async function discoverPluginStatus() {
  const injected = injectedPluginStatus();
  if (injected !== null) return injected;

  try {
    const { stdout } = await execFileAsync("codex", ["plugin", "list", "--json"], {
      cwd: pluginRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 5_000,
      windowsHide: true,
    });
    const installed = containsInstalledPlugin(JSON.parse(stdout));
    return installed === null ? "unknown" : installed ? "installed" : "not-installed";
  } catch (error) {
    return error && error.code === "ENOENT" ? "unavailable" : "unknown";
  }
}

function pluginStatusReport(status) {
  switch (status) {
    case "installed":
      return "Plugin status: rv-workflow is already installed.";
    case "not-installed":
      return "Plugin status: rv-workflow is not currently installed.";
    case "unavailable":
      return "Plugin status: unavailable because the Codex CLI was not found.";
    default:
      return "Plugin status: unknown because Codex plugin discovery was unavailable or unreadable.";
  }
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const apply = arguments_.includes("--apply");
  const positional = arguments_.filter((argument) => argument !== "--apply");
  const unknownOptions = positional.filter((argument) => argument.startsWith("-"));

  if (positional.length !== 1 || unknownOptions.length > 0) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const requestedTarget = resolve(positional[0]);
  let targetRoot;
  try {
    targetRoot = await realpath(requestedTarget);
  } catch {
    console.error(`Target project path does not exist: ${requestedTarget}`);
    process.exitCode = 2;
    return;
  }

  if ((await pathKind(targetRoot)) !== "directory") {
    console.error(`Target project path is not a directory: ${targetRoot}`);
    process.exitCode = 2;
    return;
  }

  const proposed = templates.map(([source, destination]) => ({
    source: join(pluginRoot, source),
    destination: join(targetRoot, destination),
    label: destination,
  }));

  const conflicts = [];
  for (const entry of proposed) {
    const destinationKind = await pathKind(entry.destination);
    if (destinationKind !== null) {
      conflicts.push(`${entry.label} already exists as a ${destinationKind}`);
      continue;
    }
    const unsafeParent = await findUnsafeParent(targetRoot, entry.destination);
    if (unsafeParent) {
      conflicts.push(`${entry.label} has unsafe parent ${unsafeParent.path} (${unsafeParent.kind})`);
    }
  }

  const duplicateSkillRoot = join(targetRoot, ".agents", "skills");
  const duplicateSkills = (await pathKind(duplicateSkillRoot)) === "directory";
  const runtimePins = [".node-version", ".nvmrc", ".tool-versions", "mise.toml", "package.json"];
  const detectedPins = [];
  for (const pin of runtimePins) {
    if (await pathKind(join(targetRoot, pin))) detectedPins.push(pin);
  }
  const pluginStatus = await discoverPluginStatus();

  console.log(`${apply ? "Apply" : "Dry-run"} target: ${targetRoot}`);
  for (const entry of proposed) console.log(`- ${entry.label}`);
  console.log(`Runtime pins: ${detectedPins.length > 0 ? detectedPins.join(", ") : "none detected"}`);
  console.log(pluginStatusReport(pluginStatus));
  console.log("Model availability: confirm the configured Codex model IDs before using the installed agents.");
  if (duplicateSkills) {
    console.log("Duplicate-skill warning: .agents/skills exists; remove or separate duplicate role skills after plugin installation.");
  }

  if (conflicts.length > 0) {
    console.error("Installation conflict: templates would overwrite or escape existing project paths.");
    for (const conflict of conflicts) console.error(`- ${conflict}`);
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log("Dry-run only; no files were written. Re-run with --apply after reviewing this report.");
    return;
  }

  for (const entry of proposed) {
    await mkdir(dirname(entry.destination), { recursive: true });
    await copyFile(entry.source, entry.destination);
  }
  console.log(`Installed ${proposed.length} opt-in template files without overwriting existing project files.`);
}

await main();
