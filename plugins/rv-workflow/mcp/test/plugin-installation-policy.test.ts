import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContainedPluginRelativePath(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("./")
    && !value.split("/").includes("..");
}

describe("Codex plugin MCP registration is portable", () => {
  it("uses a direct server map, mcp_servers, or validator-compatible mcpServers wrapper and lets the host resolve contained plugin-relative stdio paths", async () => {
    const configuration = JSON.parse(
      await readFile(resolve(pluginRoot, ".mcp.json"), "utf8"),
    ) as unknown;
    expect(isJsonObject(configuration)).toBe(true);
    if (!isJsonObject(configuration)) return;

    const wrapperKey = ["mcp_servers", "mcpServers"].find((key) => key in configuration);
    const directServerMap = Object.values(configuration).every(
      (value) => isJsonObject(value) && typeof value.command === "string",
    );
    expect(wrapperKey !== undefined || directServerMap).toBe(true);

    const servers = wrapperKey === undefined ? configuration : configuration[wrapperKey];
    expect(isJsonObject(servers)).toBe(true);
    if (!isJsonObject(servers)) return;

    const configuredServers = Object.values(servers);
    expect(configuredServers).not.toHaveLength(0);
    for (const server of configuredServers) {
      expect(isJsonObject(server)).toBe(true);
      if (!isJsonObject(server)) continue;

      expect(isContainedPluginRelativePath(server.cwd)).toBe(true);
      expect(Array.isArray(server.args)).toBe(true);
      const arguments_ = Array.isArray(server.args) ? server.args : [];
      expect(arguments_.some(isContainedPluginRelativePath)).toBe(true);
    }
  });
});

describe("The npm package is publishable under the RV Kang organization", () => {
  it("uses the public organization scope and ships only runtime plugin assets", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(pluginRoot, "package.json"), "utf8"),
    ) as JsonObject;

    expect(packageJson.name).toBe("@rvkang/rv-workflow");
    expect(packageJson.private).toBe(false);
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/kangjuhyup/rv-workflow.git",
    });
    expect(packageJson.files).toEqual(expect.arrayContaining([
      ".codex-plugin/",
      ".mcp.json",
      "mcp/dist/",
      "scripts/",
      "skills/",
      "templates/",
      "web/dist/",
    ]));
    expect(packageJson.bin).toEqual({
      "rv-workflow-progress": "mcp/dist/progress-cli.js",
      "rv-workflow-templates": "scripts/install-templates.mjs",
    });
    expect(packageJson.scripts).toEqual(expect.objectContaining({
      prepublishOnly: "npm run validate",
    }));
  });
});
