import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const installer = join(pluginRoot, "scripts", "install-templates.mjs");
const temporaryDirectories: string[] = [];

const templateDestinations = [
  "AGENTS.md",
  ".codex/config.toml",
  ".codex/agents/backend.toml",
  ".codex/agents/document.toml",
  ".codex/agents/frontend.toml",
  ".codex/agents/planner.toml",
  ".codex/agents/qa.toml",
  ".codex/agents/test-writer.toml",
];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fixture(): Promise<{ root: string; target: string; outsideTarget: string }> {
  const root = await mkdtemp(join(tmpdir(), "rv-workflow-installer-policy-"));
  temporaryDirectories.push(root);
  const target = join(root, "target-project");
  const outsideTarget = join(root, "unrelated-project");
  await Promise.all([mkdir(target, { recursive: true }), mkdir(outsideTarget, { recursive: true })]);
  return { root, target, outsideTarget };
}

async function invokeInstaller(
  arguments_: string[],
  options: { environment?: NodeJS.ProcessEnv } = {},
) {
  return await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((finish, reject) => {
    const child = spawn(process.execPath, [installer, ...arguments_], {
      cwd: pluginRoot,
      env: { ...process.env, ...options.environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (exitCode) => finish({ exitCode, stdout, stderr }));
  });
}

async function fileTree(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}

function report(result: { stdout: string; stderr: string }) {
  return `${result.stdout}\n${result.stderr}`;
}

describe("The opt-in template installer protects an explicitly chosen project", () => {
  it("starts the shared progress panel before every tool-using agent task, independently of tracking scope", async () => {
    const instructions = await readFile(resolve(pluginRoot, "templates", "AGENTS.md.fragment"), "utf8");

    expect(instructions).toMatch(/start of every .*tool-using agent task/iu);
    expect(instructions).toMatch(/before .*task classification/iu);
    expect(instructions).toContain(
      "npm --prefix <plugin-root> run progress:ensure -- --color --workspace <project-root>",
    );
    expect(instructions).not.toMatch(/node <plugin-root>\/scripts\/start-progress\.mjs/iu);
    expect(instructions).toMatch(/small questions.*remain untracked/isu);
    expect(instructions).toMatch(/after .*tracked task.*created.*ensure-panel/isu);
    expect(instructions).toMatch(/30 seconds.*completed/isu);
  });

  it("does not let a coordinating agent finish while runnable tracked steps remain", async () => {
    const instructions = await readFile(resolve(pluginRoot, "templates", "AGENTS.md.fragment"), "utf8");

    expect(instructions).toMatch(/before .*final response.*read .*latest .*snapshot/isu);
    expect(instructions).toMatch(/pending|in_progress/iu);
    expect(instructions).toMatch(/complete .*or .*skip/isu);
    expect(instructions).toMatch(/never infer .*completion/isu);
    expect(instructions).toMatch(/render .*completed/isu);
  });

  it("requires a target project path instead of choosing a directory implicitly", async () => {
    const result = await invokeInstaller([]);

    expect(result.exitCode).not.toBe(0);
    expect(report(result)).toMatch(/target|path|usage/i);
  });

  it("defaults to a dry run that reports proposed installation without writing to the target", async () => {
    const { target } = await fixture();
    await writeFile(join(target, "README.md"), "keep this project intact\n", "utf8");

    const result = await invokeInstaller([target]);

    expect(result.exitCode, report(result)).toBe(0);
    expect(report(result)).toMatch(/dry.run/i);
    expect(report(result)).toMatch(/AGENTS\.md/);
    expect(await fileTree(target)).toEqual(["README.md"]);
  });

  it("creates every absent opt-in template only after the user supplies --apply", async () => {
    const { target } = await fixture();

    const result = await invokeInstaller([target, "--apply"]);

    expect(result.exitCode, report(result)).toBe(0);
    expect(await fileTree(target)).toEqual([...templateDestinations].sort());
    await Promise.all(templateDestinations.map(async (destination) => {
      expect(await readFile(join(target, destination), "utf8")).not.toHaveLength(0);
    }));
  });

  it.each([
    ["existing project instructions", "AGENTS.md"],
    ["existing agent registry", ".codex/config.toml"],
    ["existing role agent", ".codex/agents/backend.toml"],
  ])("does not overwrite %s and reports a conflict", async (_policy, existingFile) => {
    const { target } = await fixture();
    const existingPath = join(target, existingFile);
    const original = `project-owned ${existingFile}\n`;
    await mkdir(dirname(existingPath), { recursive: true });
    await writeFile(existingPath, original, "utf8");

    const result = await invokeInstaller([target, "--apply"]);

    expect(result.exitCode).not.toBe(0);
    expect(report(result)).toMatch(/conflict|already exists|would overwrite/i);
    expect(await readFile(existingPath, "utf8")).toBe(original);
  });

  it("does not change a sibling project outside the explicit target", async () => {
    const { target, outsideTarget } = await fixture();
    const unrelatedInstructions = join(outsideTarget, "AGENTS.md");
    const unrelatedConfig = join(outsideTarget, ".codex", "config.toml");
    await mkdir(dirname(unrelatedConfig), { recursive: true });
    await writeFile(unrelatedInstructions, "unrelated instructions\n", "utf8");
    await writeFile(unrelatedConfig, "[agents.existing]\n", "utf8");
    const before = await fileTree(outsideTarget);

    const result = await invokeInstaller([target, "--apply"]);

    expect(result.exitCode, report(result)).toBe(0);
    expect(await fileTree(outsideTarget)).toEqual(before);
    expect(await readFile(unrelatedInstructions, "utf8")).toBe("unrelated instructions\n");
    expect(await readFile(unrelatedConfig, "utf8")).toBe("[agents.existing]\n");
  });

  it("reports an already-installed rv-workflow plugin through deterministic injected discovery", async () => {
    const { target } = await fixture();

    const result = await invokeInstaller([target], {
      environment: { RV_WORKFLOW_PLUGIN_STATUS: "installed" },
    });

    expect(result.exitCode, report(result)).toBe(0);
    expect(report(result)).toMatch(/rv-workflow.*already installed|already installed.*rv-workflow/i);
  });
});
