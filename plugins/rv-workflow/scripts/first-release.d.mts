export interface FirstReleaseManifest {
  name: string;
  version: string;
  private: boolean;
  publishConfig: { access: string };
}

export interface ReleaseArtifact {
  cleanup(): Promise<void>;
  integrity: string;
  tarball: string;
}

export interface FirstReleaseOptions {
  root?: string;
  readManifest?: () => Promise<FirstReleaseManifest>;
  verifyRuntime?: () => Promise<void>;
  verifyCandidate?: () => Promise<void>;
  git?: {
    prepare(tag: string): Promise<{ remoteTagExists: boolean; sha: string }>;
    pushTag(tag: string): Promise<unknown>;
  };
  npm?: {
    assertIdentity(): Promise<void>;
    pack(name: string, version: string): Promise<ReleaseArtifact>;
    lookupIntegrity(name: string, version: string): Promise<string | undefined>;
    publish(artifact: ReleaseArtifact): Promise<unknown>;
  };
  github?: {
    ensureRelease(tag: string, sha: string): Promise<unknown>;
  };
  sleep?: (milliseconds: number) => Promise<void>;
}

export function assertFirstReleaseManifest(manifest: unknown): {
  name: "@rvkang/rv-workflow";
  tag: "@rvkang/rv-workflow@0.1.0";
  version: "0.1.0";
};

export function assertPinnedRuntimeVersions(nodeVersion: string, npmVersion: string): void;

export function decideFirstPublication(
  localIntegrity: string,
  remoteIntegrity?: string,
): "publish" | "skip";

export function lookupRegistryIntegrity(
  name: string,
  version: string,
  request?: typeof fetch,
): Promise<string | undefined>;

export function parsePackResult(
  response: unknown,
  name: string,
  version: string,
): { filename: string; integrity: string };

export function runFirstRelease(options?: FirstReleaseOptions): Promise<{
  published: boolean;
  pushed: boolean;
  sha: string;
  tag: "@rvkang/rv-workflow@0.1.0";
}>;

export function runFirstReleaseCli(options?: {
  argv?: string[];
  interactive?: boolean;
  release?: typeof runFirstRelease;
}): ReturnType<typeof runFirstRelease>;
