import { describe, expect, it, vi } from "vitest";

import {
  assertFirstReleaseManifest,
  assertPinnedRuntimeVersions,
  decideFirstPublication,
  lookupRegistryIntegrity,
  parsePackResult,
  runFirstRelease,
} from "../../scripts/first-release.mjs";

const NAME = "@rvkang/rv-workflow";
const VERSION = "0.1.0";
const TAG = `${NAME}@${VERSION}`;
const SHA = "a".repeat(40);
const INTEGRITY = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;

const manifest = {
  name: NAME,
  version: VERSION,
  private: false,
  publishConfig: { access: "public" },
};

describe("first release automation", () => {
  it("accepts only the public @rvkang/rv-workflow 0.1.0 contract", () => {
    expect(assertFirstReleaseManifest(manifest)).toEqual({
      name: NAME,
      tag: TAG,
      version: VERSION,
    });

    expect(() => assertFirstReleaseManifest({ ...manifest, name: "@rvkang/workflow" }))
      .toThrow(/@rvkang\/rv-workflow/u);
    expect(() => assertFirstReleaseManifest({ ...manifest, version: "0.1.1" }))
      .toThrow(/0\.1\.0/u);
    expect(() => assertFirstReleaseManifest({ ...manifest, publishConfig: { access: "restricted" } }))
      .toThrow(/public/u);
    expect(() => assertPinnedRuntimeVersions("20.18.3", "12.0.2")).toThrow(/Node 24\.20\.0/u);
    expect(() => assertPinnedRuntimeVersions("24.20.0", "11.0.0")).toThrow(/npm 12\.0\.2/u);
  });

  it("publishes an absent artifact before pushing its signed tag and creating a GitHub Release", async () => {
    const events: string[] = [];
    const cleanup = vi.fn(async () => { events.push("cleanup"); });

    await expect(runFirstRelease({
      readManifest: async () => manifest,
      verifyRuntime: async () => { events.push("runtime"); },
      verifyCandidate: async () => { events.push("validate"); },
      git: {
        prepare: async () => {
          events.push("git");
          return { remoteTagExists: false, sha: SHA };
        },
        pushTag: async () => { events.push("push"); },
      },
      npm: {
        assertIdentity: async () => { events.push("identity"); },
        pack: async () => {
          events.push("pack");
          return { cleanup, integrity: INTEGRITY, tarball: "/tmp/rv-workflow.tgz" };
        },
        lookupIntegrity: async () => {
          events.push("lookup");
          return events.includes("publish") ? INTEGRITY : undefined;
        },
        publish: async () => { events.push("publish"); },
      },
      github: {
        ensureRelease: async () => { events.push("release"); },
      },
      sleep: async () => undefined,
    })).resolves.toEqual({
      published: true,
      pushed: true,
      sha: SHA,
      tag: TAG,
    });

    expect(events).toEqual([
      "runtime",
      "validate",
      "git",
      "identity",
      "pack",
      "lookup",
      "publish",
      "lookup",
      "push",
      "release",
      "cleanup",
    ]);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("resumes safely when the exact package and remote tag already exist", async () => {
    const publish = vi.fn(async () => undefined);
    const pushTag = vi.fn(async () => undefined);

    await expect(runFirstRelease({
      readManifest: async () => manifest,
      verifyRuntime: async () => undefined,
      verifyCandidate: async () => undefined,
      git: {
        prepare: async () => ({ remoteTagExists: true, sha: SHA }),
        pushTag,
      },
      npm: {
        assertIdentity: async () => undefined,
        pack: async () => ({
          cleanup: async () => undefined,
          integrity: INTEGRITY,
          tarball: "/tmp/rv-workflow.tgz",
        }),
        lookupIntegrity: async () => INTEGRITY,
        publish,
      },
      github: { ensureRelease: async () => undefined },
    })).resolves.toMatchObject({ published: false, pushed: false });

    expect(publish).not.toHaveBeenCalled();
    expect(pushTag).not.toHaveBeenCalled();
  });

  it("refuses an occupied registry version with different integrity", () => {
    expect(() => decideFirstPublication(INTEGRITY, `sha512-${Buffer.alloc(64, 2).toString("base64")}`))
      .toThrow(/different integrity/u);
  });

  it("treats an HTTP 404 as an unregistered first version and reads exact registry integrity", async () => {
    const notFound = vi.fn(async () => new Response("not found", { status: 404 }));
    await expect(lookupRegistryIntegrity(
      NAME,
      VERSION,
      notFound,
    )).resolves.toBeUndefined();

    const found = vi.fn(async () => new Response(JSON.stringify({
      dist: { integrity: INTEGRITY },
    }), { status: 200 }));
    await expect(lookupRegistryIntegrity(
      NAME,
      VERSION,
      found,
    )).resolves.toBe(INTEGRITY);

    const expectedUrl = "https://registry.npmjs.org/%40rvkang%2Frv-workflow/0.1.0";
    expect(notFound).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
    expect(found).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
  });

  it("accepts npm 12 keyed pack metadata as well as the legacy array shape", () => {
    const item = {
      filename: "rvkang-rv-workflow-0.1.0.tgz",
      id: `${NAME}@${VERSION}`,
      integrity: INTEGRITY,
    };

    expect(parsePackResult({ [NAME]: item }, NAME, VERSION)).toEqual({
      filename: item.filename,
      integrity: INTEGRITY,
    });
    expect(parsePackResult([item], NAME, VERSION)).toEqual({
      filename: item.filename,
      integrity: INTEGRITY,
    });
  });
});
