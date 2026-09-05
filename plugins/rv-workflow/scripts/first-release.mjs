import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(process.cwd());
const PACKAGE_NAME = "@rvkang/rv-workflow";
const FIRST_VERSION = "0.1.0";
const EXPECTED_NPM_USER = "kangjuhyup";
const EXPECTED_NODE_VERSION = "24.20.0";
const EXPECTED_NPM_VERSION = "12.0.2";
const GITHUB_REPOSITORY = "kangjuhyup/rv-workflow";
const NPM_REGISTRY = "https://registry.npmjs.org";
const COREPACK_COMMAND = process.platform === "win32" ? "corepack.cmd" : "corepack";
const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHA512_SRI = /^sha512-([A-Za-z0-9+/]{86}==)$/u;
const CONFIRMATION_ATTEMPTS = 6;
const CONFIRMATION_DELAY_MILLISECONDS = 5_000;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const commandError = (command, arguments_, code, stdout, stderr) => {
  const error = new Error(`${command} ${arguments_.join(" ")} exited with code ${code}.`);
  error.code = code;
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
};

const runCommand = (command, arguments_, { cwd, inherited = false } = {}) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, arguments_, {
    cwd,
    env: process.env,
    stdio: inherited ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  if (!inherited) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
  }

  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) {
      resolvePromise({ stderr, stdout });
      return;
    }

    reject(commandError(command, arguments_, code, stdout, stderr));
  });
});

const assertSha = (value, label) => {
  if (typeof value !== "string" || !FULL_SHA.test(value)) {
    throw new Error(`${label} must be a 40-character lowercase commit SHA.`);
  }

  return value;
};

const assertIntegrity = (value, label) => {
  const match = typeof value === "string" ? SHA512_SRI.exec(value) : undefined;
  const encoded = match?.[1];

  if (encoded === undefined || Buffer.from(encoded, "base64").length !== 64) {
    throw new Error(`${label} must be a valid sha512 integrity value.`);
  }

  return value;
};

export const assertFirstReleaseManifest = (manifest) => {
  if (!isRecord(manifest) || manifest.name !== PACKAGE_NAME) {
    throw new Error(`First release package name must be ${PACKAGE_NAME}.`);
  }

  if (manifest.version !== FIRST_VERSION) {
    throw new Error(`First release version must be ${FIRST_VERSION}.`);
  }

  if (manifest.private !== false || !isRecord(manifest.publishConfig) || manifest.publishConfig.access !== "public") {
    throw new Error("First release package must be public and publishConfig.access must be public.");
  }

  return {
    name: PACKAGE_NAME,
    tag: `${PACKAGE_NAME}@${FIRST_VERSION}`,
    version: FIRST_VERSION,
  };
};

export const assertPinnedRuntimeVersions = (nodeVersion, npmVersion) => {
  if (nodeVersion !== EXPECTED_NODE_VERSION) {
    throw new Error(`release:first requires Node ${EXPECTED_NODE_VERSION}; received ${nodeVersion}.`);
  }
  if (npmVersion !== EXPECTED_NPM_VERSION) {
    throw new Error(`release:first requires npm ${EXPECTED_NPM_VERSION}; received ${npmVersion}.`);
  }
};

export const decideFirstPublication = (localIntegrity, remoteIntegrity = undefined) => {
  assertIntegrity(localIntegrity, "Local artifact");

  if (remoteIntegrity === undefined) {
    return "publish";
  }

  assertIntegrity(remoteIntegrity, "Registry artifact");
  if (localIntegrity === remoteIntegrity) {
    return "skip";
  }

  throw new Error("Registry version is occupied with different integrity.");
};

export const parsePackResult = (response, name, version) => {
  const item = Array.isArray(response)
    ? (response.length === 1 ? response[0] : undefined)
    : (isRecord(response) ? response[name] : undefined);

  if (
    !isRecord(item)
    || item.id !== `${name}@${version}`
    || typeof item.filename !== "string"
    || item.filename.length === 0
  ) {
    throw new Error("npm pack returned unexpected package metadata.");
  }

  return {
    filename: item.filename,
    integrity: assertIntegrity(item.integrity, "Packed artifact"),
  };
};

const readManifest = async (root = PLUGIN_ROOT) => JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);

const assertNoPendingChangesets = async (root) => {
  const directory = resolve(root, ".changeset");
  const entries = await readdir(directory, { withFileTypes: true });
  const pending = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort();

  if (pending.length > 0) {
    throw new Error(
      `First release must absorb pending Changesets before publishing: ${pending.join(", ")}.`,
    );
  }
};

const createGitAdapter = ({ root = PLUGIN_ROOT, run = runCommand } = {}) => ({
  prepare: async (tag) => {
    const status = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root });
    if (status.stdout.length > 0) {
      throw new Error("First release worktree must be clean.");
    }

    const branch = await run("git", ["branch", "--show-current"], { cwd: root });
    if (branch.stdout.trim() !== "main") {
      throw new Error("First release must run from the main branch.");
    }

    await run("git", ["fetch", "--tags", "origin", "refs/heads/main:refs/remotes/origin/main"], { cwd: root });
    const head = assertSha(
      (await run("git", ["rev-parse", "--verify", "HEAD^{commit}"], { cwd: root })).stdout.trim(),
      "Release HEAD",
    );
    const remoteMain = assertSha(
      (await run("git", ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"], { cwd: root })).stdout.trim(),
      "origin/main",
    );

    if (head !== remoteMain) {
      throw new Error(`Release HEAD ${head} must exactly match origin/main ${remoteMain}.`);
    }

    const resolveLocalTag = async () => {
      try {
        return assertSha(
          (await run("git", ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`], { cwd: root })).stdout.trim(),
          `Local tag ${tag}`,
        );
      } catch (error) {
        if (isRecord(error) && error.code === 128) return undefined;
        throw error;
      }
    };
    const resolveRemoteTag = async () => {
      try {
        const result = await run("git", [
          "ls-remote",
          "--exit-code",
          "--tags",
          "origin",
          `refs/tags/${tag}`,
          `refs/tags/${tag}^{}`,
        ], { cwd: root });
        const lines = result.stdout.trim().split("\n").filter(Boolean);
        const peeled = lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`));
        const direct = lines.find((line) => line.endsWith(`refs/tags/${tag}`));
        const selected = peeled ?? direct;
        return selected === undefined ? undefined : assertSha(selected.split("\t")[0], `Remote tag ${tag}`);
      } catch (error) {
        if (isRecord(error) && error.code === 2) return undefined;
        throw error;
      }
    };

    let localTag = await resolveLocalTag();
    const remoteTag = await resolveRemoteTag();
    if (localTag !== undefined && localTag !== head) {
      throw new Error(`Local tag ${tag} does not point to release HEAD.`);
    }
    if (remoteTag !== undefined && remoteTag !== head) {
      throw new Error(`Remote tag ${tag} does not point to release HEAD.`);
    }
    if (localTag === undefined && remoteTag !== undefined) {
      throw new Error(`Remote tag ${tag} exists but was not fetched locally.`);
    }
    if (localTag === undefined) {
      await run("git", ["tag", "-s", "-m", `Release ${tag}`, tag, head], { cwd: root, inherited: true });
      localTag = await resolveLocalTag();
    }

    await run("git", ["verify-tag", tag], { cwd: root, inherited: true });
    if (localTag !== head) {
      throw new Error(`Signed tag ${tag} does not resolve to release HEAD.`);
    }

    return { remoteTagExists: remoteTag !== undefined, sha: head };
  },
  pushTag: (tag) => run(
    "git",
    ["push", "origin", `refs/tags/${tag}:refs/tags/${tag}`],
    { cwd: root, inherited: true },
  ),
});

export const lookupRegistryIntegrity = async (
  name,
  version,
  request = globalThis.fetch,
) => {
  if (typeof request !== "function") {
    throw new Error("Registry lookup requires the Fetch API.");
  }

  const response = await request(
    `${NPM_REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    {
      headers: { accept: "application/json" },
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`npm registry lookup failed with HTTP ${response.status}.`);
  }

  const release = await response.json();
  const integrity = isRecord(release) && isRecord(release.dist) ? release.dist.integrity : undefined;
  return assertIntegrity(integrity, `${name}@${version}`);
};

const createNpmAdapter = ({ root = PLUGIN_ROOT, run = runCommand } = {}) => ({
  assertIdentity: async () => {
    const result = await run(COREPACK_COMMAND, ["npm", "whoami", "--registry", NPM_REGISTRY], { cwd: root });
    if (result.stdout.trim() !== EXPECTED_NPM_USER) {
      throw new Error(`npm identity must be ${EXPECTED_NPM_USER}.`);
    }
  },
  pack: async (name, version) => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "rv-workflow-first-release-"));

    try {
      const result = await run(COREPACK_COMMAND, ["npm", "pack", "--json", "--pack-destination", artifactRoot], { cwd: root });
      const response = JSON.parse(result.stdout);
      const item = parsePackResult(response, name, version);

      const canonicalRoot = await realpath(artifactRoot);
      const tarball = await realpath(resolve(artifactRoot, basename(item.filename)));
      const fromRoot = relative(canonicalRoot, tarball);
      if (fromRoot.length === 0 || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
        throw new Error("Packed artifact escaped its temporary directory.");
      }

      return {
        cleanup: () => rm(artifactRoot, { force: true, recursive: true }),
        integrity: item.integrity,
        tarball,
      };
    } catch (error) {
      await rm(artifactRoot, { force: true, recursive: true });
      throw error;
    }
  },
  lookupIntegrity: (name, version) => lookupRegistryIntegrity(name, version),
  publish: (artifact) => run(COREPACK_COMMAND, ["npm",
    "publish",
    "--access",
    "public",
    "--registry",
    NPM_REGISTRY,
    "--",
    artifact.tarball,
  ], { cwd: root, inherited: true }),
});

const createGitHubAdapter = ({ root = PLUGIN_ROOT, run = runCommand } = {}) => ({
  ensureRelease: async (tag) => {
    try {
      const result = await run("gh", [
        "api",
        `repos/${GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`,
      ], { cwd: root });
      const release = JSON.parse(result.stdout);
      if (!isRecord(release) || release.tag_name !== tag || release.draft !== false || release.prerelease !== false) {
        throw new Error(`Existing GitHub Release for ${tag} conflicts with the release contract.`);
      }
      return;
    } catch (error) {
      if (!(isRecord(error) && error.code === 1 && typeof error.stderr === "string" && /HTTP 404/u.test(error.stderr))) {
        throw error;
      }
    }

    await run("gh", [
      "release",
      "create",
      tag,
      "--repo",
      GITHUB_REPOSITORY,
      "--verify-tag",
      "--generate-notes",
      "--title",
      tag,
    ], { cwd: root, inherited: true });
  },
});

const defaultVerifyCandidate = async (root) => {
  await assertNoPendingChangesets(root);
  await runCommand(COREPACK_COMMAND, ["npm", "run", "validate"], { cwd: root, inherited: true });
};

const defaultVerifyRuntime = async (root) => {
  const npmVersion = (await runCommand(COREPACK_COMMAND, ["npm", "--version"], { cwd: root })).stdout.trim();
  assertPinnedRuntimeVersions(process.versions.node, npmVersion);
};

const confirmPublication = async ({ name, version, integrity, npm, sleep }) => {
  for (let attempt = 1; attempt <= CONFIRMATION_ATTEMPTS; attempt += 1) {
    const remoteIntegrity = await npm.lookupIntegrity(name, version);
    if (remoteIntegrity === integrity) return;
    if (remoteIntegrity !== undefined) {
      decideFirstPublication(integrity, remoteIntegrity);
    }
    if (attempt < CONFIRMATION_ATTEMPTS) {
      await sleep(CONFIRMATION_DELAY_MILLISECONDS);
    }
  }

  throw new Error(`${name}@${version} was not visible with the expected integrity after publishing.`);
};

export const runFirstRelease = async ({
  root = PLUGIN_ROOT,
  readManifest: read = () => readManifest(root),
  verifyRuntime = () => defaultVerifyRuntime(root),
  verifyCandidate = () => defaultVerifyCandidate(root),
  git = createGitAdapter({ root }),
  npm = createNpmAdapter({ root }),
  github = createGitHubAdapter({ root }),
  sleep = (milliseconds) => new Promise((resolvePromise) => { setTimeout(resolvePromise, milliseconds); }),
} = {}) => {
  await verifyRuntime();
  const contract = assertFirstReleaseManifest(await read());
  await verifyCandidate();
  const prepared = await git.prepare(contract.tag);
  await npm.assertIdentity();
  const artifact = await npm.pack(contract.name, contract.version);

  try {
    const remoteIntegrity = await npm.lookupIntegrity(contract.name, contract.version);
    const decision = decideFirstPublication(artifact.integrity, remoteIntegrity);
    const published = decision === "publish";

    if (published) {
      await npm.publish(artifact);
      await confirmPublication({ ...contract, integrity: artifact.integrity, npm, sleep });
    }

    const pushed = !prepared.remoteTagExists;
    if (pushed) {
      await git.pushTag(contract.tag);
    }

    await github.ensureRelease(contract.tag, prepared.sha);
    return { published, pushed, sha: prepared.sha, tag: contract.tag };
  } finally {
    await artifact.cleanup();
  }
};

export const runFirstReleaseCli = async ({
  argv = process.argv.slice(2),
  interactive = process.stdin.isTTY && process.stdout.isTTY,
  release = runFirstRelease,
} = {}) => {
  if (argv.length !== 0) {
    throw new Error("release:first accepts no arguments.");
  }
  if (!interactive) {
    throw new Error("release:first requires an interactive terminal for npm 2FA.");
  }

  const result = await release();
  process.stdout.write(
    `${result.tag}: npm ${result.published ? "published" : "already matched"}; `
    + `tag ${result.pushed ? "pushed" : "already existed"}; GitHub Release ready.\n`,
  );
  return result;
};

const isDirectExecution = () => typeof import.meta.url === "string"
  && import.meta.url.startsWith("file:")
  && process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution()) {
  try {
    await runFirstReleaseCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
