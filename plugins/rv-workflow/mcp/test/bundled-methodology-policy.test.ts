import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(pluginRoot, "../..");

const superpowersWorkflows = [
  "brainstorming",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
] as const;

const ponytailSkills = [
  "ponytail",
  "ponytail-audit",
  "ponytail-debt",
  "ponytail-gain",
  "ponytail-help",
  "ponytail-review",
] as const;

describe("RV Workflow ships its methodology without external plugin dependencies", () => {
  it("routes every supported Superpowers workflow to a bundled reference", async () => {
    const router = await readFile(
      resolve(pluginRoot, "skills/scoped-superpowers/references/routing.md"),
      "utf8",
    );

    for (const workflow of superpowersWorkflows) {
      const relativeReference = `superpowers/${workflow}.md`;
      expect(router).toContain(`(${relativeReference})`);
      const contents = await readFile(
        resolve(
          pluginRoot,
          "skills/scoped-superpowers/references",
          relativeReference,
        ),
        "utf8",
      );
      expect(contents.trim().length).toBeGreaterThan(100);
    }

    const source = JSON.parse(
      await readFile(
        resolve(
          pluginRoot,
          "skills/scoped-superpowers/references/superpowers/source.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(source).toEqual(expect.objectContaining({
      name: "Superpowers",
      version: "6.3.0",
      license: "MIT",
      integration: "adapted-references",
    }));
  });

  it("does not instruct project agents to invoke an external Superpowers skill", async () => {
    const policyFiles = await Promise.all([
      readFile(resolve(repositoryRoot, "AGENTS.md"), "utf8"),
      readFile(resolve(pluginRoot, "templates/AGENTS.md.fragment"), "utf8"),
      readFile(resolve(pluginRoot, "skills/scoped-superpowers/SKILL.md"), "utf8"),
      readFile(
        resolve(pluginRoot, "skills/scoped-superpowers/references/routing.md"),
        "utf8",
      ),
    ]);

    for (const policy of policyFiles) {
      expect(policy).not.toMatch(/(?:\$|`)superpowers:[a-z-]+/);
    }
  });

  it("bundles the six Ponytail 4.9.0 skills with explicit activation for the persistent mode", async () => {
    for (const skill of ponytailSkills) {
      const contents = await readFile(
        resolve(pluginRoot, "skills", skill, "SKILL.md"),
        "utf8",
      );
      expect(contents).toMatch(new RegExp(`^---\\nname: ${skill}\\n`, "m"));
    }

    const ponytailMetadata = await readFile(
      resolve(pluginRoot, "skills/ponytail/agents/openai.yaml"),
      "utf8",
    );
    expect(ponytailMetadata).toContain("allow_implicit_invocation: false");

    const source = JSON.parse(
      await readFile(resolve(pluginRoot, "skills/ponytail/source.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(source).toEqual(expect.objectContaining({
      name: "Ponytail",
      version: "4.9.0",
      revision: "0a4dd63ad4541f4f655c4108a295916f3c1d8fda",
      license: "MIT",
    }));
  });

  it("publishes both upstream license notices in the npm artifact", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(pluginRoot, "package.json"), "utf8"),
    ) as { files?: string[] };
    expect(packageJson.files).toEqual(expect.arrayContaining([
      "THIRD_PARTY_NOTICES.md",
      "licenses/",
    ]));

    const notices = await readFile(
      resolve(pluginRoot, "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    expect(notices).toContain("Superpowers 6.3.0");
    expect(notices).toContain("Ponytail 4.9.0");

    const [superpowersLicense, ponytailLicense] = await Promise.all([
      readFile(resolve(pluginRoot, "licenses/SUPERPOWERS-MIT.txt"), "utf8"),
      readFile(resolve(pluginRoot, "licenses/PONYTAIL-MIT.txt"), "utf8"),
    ]);
    expect(superpowersLicense).toContain("Copyright (c) 2025 Jesse Vincent");
    expect(ponytailLicense).toContain("Copyright (c) 2026 DietrichGebert");
  });
});
