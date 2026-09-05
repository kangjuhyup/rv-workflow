import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(pluginRoot, "../..");

describe("The npm release workflow is driven by Changesets", () => {
  it("versions the public package from the main branch", async () => {
    const configuration = JSON.parse(
      await readFile(resolve(pluginRoot, ".changeset/config.json"), "utf8"),
    ) as Record<string, unknown>;
    const packageJson = JSON.parse(
      await readFile(resolve(pluginRoot, "package.json"), "utf8"),
    ) as {
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(configuration).toEqual(expect.objectContaining({
      access: "public",
      baseBranch: "main",
      commit: false,
    }));
    expect(packageJson.devDependencies?.["@changesets/cli"]).toBe("3.0.2");
    expect(packageJson.scripts).toEqual(expect.objectContaining({
      "changeset:version": "changeset version",
      release: "changeset publish",
      "release:first": "node scripts/start-first-release.mjs",
    }));
  });

  it("publishes through npm and pushes immutable package tags", async () => {
    const workflow = await readFile(
      resolve(repositoryRoot, ".github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain("branches:\n      - main");
    expect(workflow).toContain("cwd: plugins/rv-workflow");
    expect(workflow).toContain("npm install --global npm@12.0.2");
    expect(workflow).toContain('test "$(npm --version)" = "12.0.2"');
    expect(workflow).not.toContain("corepack install");
    expect(workflow).not.toContain(".github/bin/npm");
    expect(workflow).toContain("publish-script: npm run release");
    expect(workflow).toContain("push-git-tags: true");
    expect(workflow).toContain("create-github-releases: true");
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(workflow).toMatch(/actions\/checkout@[0-9a-f]{40}/);
    expect(workflow).toMatch(/actions\/setup-node@[0-9a-f]{40}/);
    expect(workflow).toMatch(/changesets\/action@[0-9a-f]{40}/);
  });
});
