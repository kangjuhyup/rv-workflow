import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runProgressCli } from "../src/progress-cli.js";
import {
  detectProgressPanelLauncher,
  launchProgressPanel,
  type RunCommand,
} from "../src/progress-panel-launcher.js";
import {
  claimProgressPanel,
  reserveProgressPanel,
} from "../src/progress-panel-instance.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function temporaryInstanceDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rv-workflow-panel-instance-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writableBuffer() {
  let contents = "";
  return {
    get contents() {
      return contents;
    },
    isTTY: false,
    write(chunk: string | Uint8Array) {
      contents += String(chunk);
      return true;
    },
  };
}

const dangerousWorkspace = "/tmp/work space/$(touch should-not-run)";
const dangerousTaskId = "task; echo should-not-run";
const dangerousStateDirectory = "/tmp/state dir/$(touch should-not-run)";
const nodePath = "/absolute/node runtime/node";
const compiledCli = "/opt/rv-workflow/mcp/dist/progress-cli.js";

function succeedingRunCommand() {
  return vi.fn<RunCommand>(async () => ({ exitCode: 0 }));
}

function commandInvocation(runCommand: { mock: { calls: Parameters<RunCommand>[] } }): Parameters<RunCommand> {
  const invocation = runCommand.mock.calls[0];
  if (invocation === undefined) throw new Error("Expected the terminal launcher to run a command.");
  return invocation;
}

describe("Panel launcher routing follows the terminal environment", () => {
  it.each([
    ["tmux ahead of an embedded Orca terminal", { TMUX: "session", TERM_PROGRAM: "Orca" }, "tmux"],
    ["an Orca terminal", { TERM_PROGRAM: "Orca" }, "orca"],
    ["an iTerm2 terminal", { TERM_PROGRAM: "iTerm.app" }, "iterm2"],
    ["the macOS Terminal fallback", {}, "terminal"],
  ])("selects %s", (_scenario, env, expected) => {
    expect(detectProgressPanelLauncher({ platform: "darwin", env })).toBe(expected);
  });

  it("honors an explicit launcher override over the detected environment", () => {
    expect(detectProgressPanelLauncher({
      platform: "darwin",
      env: { TMUX: "session", TERM_PROGRAM: "Orca" },
      launcher: "terminal",
    })).toBe("terminal");
  });

  it("does not automatically route an unmanaged Linux terminal through Orca", () => {
    expect(detectProgressPanelLauncher({ platform: "linux", env: {} })).toBe("unsupported");
  });
});

describe("The panel CLI mode launches a watcher without reading task state itself", () => {
  it("preserves watcher options for the launcher and never opens the task-progress service", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const launchPanel = vi.fn(async () => undefined);
    const createService = vi.fn(async () => {
      throw new Error("Panel mode must not open task state in the calling process.");
    });

    const exitCode = await runProgressCli({
      argv: [
        "--panel",
        "--workspace", dangerousWorkspace,
        "--task-id", dangerousTaskId,
        "--state-dir", dangerousStateDirectory,
        "--interval", "250",
        "--no-color",
      ],
      stdout,
      stderr,
      launchPanel,
      createService,
    });

    expect(exitCode).toBe(0);
    expect(createService).not.toHaveBeenCalled();
    expect(launchPanel).toHaveBeenCalledOnce();
    expect(launchPanel).toHaveBeenCalledWith(expect.objectContaining({
      nodePath: expect.any(String),
      workspaceRoot: dangerousWorkspace,
      taskId: dangerousTaskId,
      stateDirectory: dangerousStateDirectory,
      intervalMs: 250,
      color: false,
    }));
    expect(stdout.contents).toBe("");
    expect(stderr.contents).toBe("");
  });

  it.each(["auto", "tmux", "orca", "iterm2", "terminal"] as const)(
    "passes the %s launcher preference to panel launch",
    async (launcher) => {
      const launchPanel = vi.fn(async () => undefined);
      const createService = vi.fn(async () => {
        throw new Error("A panel preference must not open task state in the calling process.");
      });

      const exitCode = await runProgressCli({
        argv: ["--panel", "--panel-launcher", launcher, "--workspace", "/workspace"],
        stdout: writableBuffer(),
        stderr: writableBuffer(),
        launchPanel,
        createService,
      });

      expect(exitCode).toBe(0);
      expect(launchPanel).toHaveBeenCalledWith(expect.objectContaining({ launcher }));
      expect(createService).not.toHaveBeenCalled();
    },
  );

  it("ensures one workspace panel and leaves an existing live reservation alone", async () => {
    const instanceDirectory = await temporaryInstanceDirectory();
    const launchPanel = vi.fn(async () => undefined);
    const cliOptions = {
      argv: ["--ensure-panel", "--workspace", "/workspace"],
      stdout: writableBuffer(),
      stderr: writableBuffer(),
      launchPanel,
      instanceDirectory,
    };

    expect(await runProgressCli(cliOptions)).toBe(0);
    expect(await runProgressCli(cliOptions)).toBe(0);

    expect(launchPanel).toHaveBeenCalledOnce();
    expect(launchPanel).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: "/workspace",
      idleTimeoutMs: 30_000,
      instanceFile: expect.stringContaining(instanceDirectory),
      instanceToken: expect.any(String),
    }));
  });

  it("releases a failed ensure-panel reservation so a later agent can retry", async () => {
    const instanceDirectory = await temporaryInstanceDirectory();
    const launchPanel = vi.fn()
      .mockRejectedValueOnce(new Error("Unable to open a terminal panel."))
      .mockResolvedValueOnce(undefined);

    const failed = await runProgressCli({
      argv: ["--ensure-panel", "--workspace", "/workspace"],
      stdout: writableBuffer(),
      stderr: writableBuffer(),
      launchPanel,
      instanceDirectory,
    });
    const retried = await runProgressCli({
      argv: ["--ensure-panel", "--workspace", "/workspace"],
      stdout: writableBuffer(),
      stderr: writableBuffer(),
      launchPanel,
      instanceDirectory,
    });

    expect(failed).toBe(1);
    expect(retried).toBe(0);
    expect(launchPanel).toHaveBeenCalledTimes(2);
  });

  it("keeps ensure-panel workspace-scoped by rejecting a fixed task selector", async () => {
    const launchPanel = vi.fn(async () => undefined);
    const stderr = writableBuffer();

    const exitCode = await runProgressCli({
      argv: ["--ensure-panel", "--workspace", "/workspace", "--task-id", "task-1"],
      stdout: writableBuffer(),
      stderr,
      launchPanel,
    });

    expect(exitCode).toBe(2);
    expect(stderr.contents).toMatch(/latest active workspace task/iu);
    expect(launchPanel).not.toHaveBeenCalled();
  });

  it("lets an explicit color request override a parent NO_COLOR setting", async () => {
    vi.stubEnv("NO_COLOR", "1");
    const instanceDirectory = await temporaryInstanceDirectory();
    const launchPanel = vi.fn(async () => undefined);

    const exitCode = await runProgressCli({
      argv: ["--ensure-panel", "--color", "--workspace", "/workspace"],
      stdout: writableBuffer(),
      stderr: writableBuffer(),
      launchPanel,
      instanceDirectory,
    });

    expect(exitCode).toBe(0);
    expect(launchPanel).toHaveBeenCalledWith(expect.objectContaining({ color: true }));
  });

  it.each([
    ["--once", "--panel", "--once", "--workspace", "/workspace"],
    ["--watch", "--panel", "--watch", "--workspace", "/workspace"],
    ["--ensure-panel", "--panel", "--ensure-panel", "--workspace", "/workspace"],
  ])("rejects --panel together with %s before opening state or a launcher", async (conflict, ...argv) => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const launchPanel = vi.fn(async () => undefined);
    const createService = vi.fn(async () => {
      throw new Error("Conflicting modes must be rejected before opening task state.");
    });

    const exitCode = await runProgressCli({ argv, stdout, stderr, launchPanel, createService });

    expect(exitCode).not.toBe(0);
    expect(stderr.contents).toMatch(new RegExp(`--panel.*${conflict}|${conflict}.*--panel`, "u"));
    expect(stderr.contents).toMatch(/usage:/iu);
    expect(launchPanel).not.toHaveBeenCalled();
    expect(createService).not.toHaveBeenCalled();
    expect(stdout.contents).toBe("");
  });

  it("returns a non-zero exit with a safe launcher error when the panel cannot open", async () => {
    const stderr = writableBuffer();
    const exitCode = await runProgressCli({
      argv: ["--panel", "--workspace", dangerousWorkspace],
      stdout: writableBuffer(),
      stderr,
      launchPanel: async () => {
        throw new Error("Unable to open a terminal panel.");
      },
      createService: async () => {
        throw new Error("The launcher error must be reported before state is opened.");
      },
    });

    expect(exitCode).not.toBe(0);
    expect(stderr.contents).toContain("Unable to open a terminal panel.");
    expect(stderr.contents).not.toContain(dangerousWorkspace);
  });

  it.each([
    ["an unsupported launcher value", ["--panel", "--panel-launcher", "sidecar", "--workspace", "/workspace"], /panel-launcher/iu],
    ["a launcher preference without panel mode", ["--panel-launcher", "tmux", "--workspace", "/workspace"], /requires --panel/iu],
  ])("rejects %s before invoking a launcher or service", async (_scenario, argv, expectedError) => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const launchPanel = vi.fn(async () => undefined);
    const createService = vi.fn(async () => {
      throw new Error("Invalid panel options must be rejected before state is opened.");
    });

    const exitCode = await runProgressCli({ argv, stdout, stderr, launchPanel, createService });

    expect(exitCode).not.toBe(0);
    expect(stderr.contents).toMatch(expectedError);
    expect(stderr.contents).toMatch(/usage:/iu);
    expect(launchPanel).not.toHaveBeenCalled();
    expect(createService).not.toHaveBeenCalled();
    expect(stdout.contents).toBe("");
  });
});

describe("Terminal panel launchers preserve watcher arguments without command injection", () => {
  it("passes the private instance claim to an ensured watcher", async () => {
    const runCommand = succeedingRunCommand();

    await launchProgressPanel({
      nodePath,
      cliPath: compiledCli,
      workspaceRoot: "/workspace",
      intervalMs: 1_000,
      idleTimeoutMs: 30_000,
      color: true,
      instanceFile: "/tmp/rv-workflow-progress/workspace.json",
      instanceToken: "reservation-token",
      platform: "darwin",
      env: { TMUX: "session" },
      runCommand,
    });

    const [, args] = commandInvocation(runCommand);
    expect(args.find((value: unknown) => typeof value === "string" && value.includes("--watch"))).toContain(
      "'--color' '--idle-timeout' '30000' '--instance-file' '/tmp/rv-workflow-progress/workspace.json' '--instance-token' 'reservation-token'",
    );
  });

  it("opens a TMUX split running the compiled CLI in watch mode with shell-quoted values", async () => {
    const runCommand = succeedingRunCommand();

    await launchProgressPanel({
      nodePath,
      cliPath: compiledCli,
      workspaceRoot: dangerousWorkspace,
      taskId: dangerousTaskId,
      stateDirectory: dangerousStateDirectory,
      intervalMs: 250,
      color: false,
      platform: "darwin",
      env: { TMUX: "/tmp/tmux-1000/default,123,0" },
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledOnce();
    const [file, args] = commandInvocation(runCommand);
    expect(file).toBe("tmux");
    expect(args).toContain("split-window");
    const shellCommand = args.find((value: unknown) => typeof value === "string" && value.includes("--watch"));
    expect(shellCommand).toBe(
      "'/absolute/node runtime/node' '/opt/rv-workflow/mcp/dist/progress-cli.js' '--watch' '--workspace' '/tmp/work space/$(touch should-not-run)' '--task-id' 'task; echo should-not-run' '--state-dir' '/tmp/state dir/$(touch should-not-run)' '--interval' '250' '--no-color'",
    );
  });

  it.each([
    ["zsh", "/bin/zsh"],
    ["bash", "/bin/bash"],
  ])("uses the same POSIX-quoted watcher command for %s", async (_shellName, shell) => {
    const runCommand = succeedingRunCommand();

    await launchProgressPanel({
      nodePath,
      cliPath: compiledCli,
      workspaceRoot: dangerousWorkspace,
      taskId: dangerousTaskId,
      stateDirectory: dangerousStateDirectory,
      intervalMs: 250,
      color: false,
      platform: "darwin",
      env: { TMUX: "session", SHELL: shell },
      runCommand,
    });

    const [, args] = commandInvocation(runCommand);
    expect(args.find((value: unknown) => typeof value === "string" && value.includes("--watch"))).toBe(
      "'/absolute/node runtime/node' '/opt/rv-workflow/mcp/dist/progress-cli.js' '--watch' '--workspace' '/tmp/work space/$(touch should-not-run)' '--task-id' 'task; echo should-not-run' '--state-dir' '/tmp/state dir/$(touch should-not-run)' '--interval' '250' '--no-color'",
    );
  });

  it("uses Orca's horizontal terminal split and its configured CLI executable", async () => {
    const runCommand = succeedingRunCommand();

    await launchProgressPanel({
      nodePath,
      cliPath: compiledCli,
      workspaceRoot: dangerousWorkspace,
      taskId: dangerousTaskId,
      stateDirectory: dangerousStateDirectory,
      intervalMs: 250,
      color: false,
      platform: "darwin",
      env: { TERM_PROGRAM: "Orca", ORCA_CLI_COMMAND: "/custom/bin/orca" },
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledWith("/custom/bin/orca", [
      "terminal",
      "split",
      "--direction",
      "horizontal",
      "--command",
      "exec '/absolute/node runtime/node' '/opt/rv-workflow/mcp/dist/progress-cli.js' '--watch' '--workspace' '/tmp/work space/$(touch should-not-run)' '--task-id' 'task; echo should-not-run' '--state-dir' '/tmp/state dir/$(touch should-not-run)' '--interval' '250' '--no-color'",
      "--json",
    ]);
  });

  it("uses the default Orca CLI only when an Orca terminal is detected", async () => {
    const runCommand = succeedingRunCommand();

    await launchProgressPanel({
      nodePath,
      cliPath: compiledCli,
      workspaceRoot: "/workspace",
      intervalMs: 1_000,
      color: true,
      platform: "darwin",
      env: { TERM_PROGRAM: "Orca" },
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledWith("orca", expect.arrayContaining([
      "terminal",
      "split",
      "--direction",
      "horizontal",
      "--command",
      "--json",
    ]));
  });

  it("opens iTerm2 with its vertical split AppleScript and a separately supplied watcher command", async () => {
    const runCommand = succeedingRunCommand();

    await launchProgressPanel({
      nodePath,
      cliPath: compiledCli,
      workspaceRoot: dangerousWorkspace,
      taskId: dangerousTaskId,
      stateDirectory: dangerousStateDirectory,
      intervalMs: 250,
      color: false,
      platform: "darwin",
      env: { TERM_PROGRAM: "iTerm.app" },
      runCommand,
    });

    const [file, args] = commandInvocation(runCommand);
    expect(file).toBe("/usr/bin/osascript");
    expect(args).toEqual(expect.arrayContaining(["-e", "--"]));
    const script = args[args.indexOf("-e") + 1];
    expect(script).toEqual(expect.stringContaining("split vertically with same profile command"));
    expect(script).not.toContain(dangerousWorkspace);
    expect(args).toContain(
      "'/absolute/node runtime/node' '/opt/rv-workflow/mcp/dist/progress-cli.js' '--watch' '--workspace' '/tmp/work space/$(touch should-not-run)' '--task-id' 'task; echo should-not-run' '--state-dir' '/tmp/state dir/$(touch should-not-run)' '--interval' '250' '--no-color'",
    );
  });

  it("opens macOS Terminal through osascript with user values passed as arguments, not interpolated into JXA", async () => {
    const runCommand = succeedingRunCommand();

    await launchProgressPanel({
      nodePath,
      cliPath: compiledCli,
      workspaceRoot: dangerousWorkspace,
      taskId: dangerousTaskId,
      stateDirectory: dangerousStateDirectory,
      intervalMs: 250,
      color: false,
      platform: "darwin",
      env: {},
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledOnce();
    const [file, args] = commandInvocation(runCommand);
    expect(file).toBe("/usr/bin/osascript");
    expect(args).toEqual(expect.arrayContaining([
      "-l",
      "JavaScript",
      "-e",
      "--",
      nodePath,
      compiledCli,
      "--watch",
      "--workspace",
      dangerousWorkspace,
      "--task-id",
      dangerousTaskId,
      "--state-dir",
      dangerousStateDirectory,
      "--interval",
      "250",
      "--no-color",
    ]));
    const script = args[args.indexOf("-e") + 1];
    expect(script).toEqual(expect.any(String));
    expect(script).not.toContain(dangerousWorkspace);
    expect(script).not.toContain(dangerousTaskId);
    expect(script).not.toContain(dangerousStateDirectory);
  });

  it("rejects unsupported platforms without exposing user-provided command content", async () => {
    await expect(launchProgressPanel({
      nodePath,
      cliPath: compiledCli,
      workspaceRoot: dangerousWorkspace,
      intervalMs: 250,
      color: true,
      platform: "linux",
      env: {},
      runCommand: async () => ({ exitCode: 0 }),
    })).rejects.toThrow(/panel.*macOS|macOS.*panel/iu);
  });

  it("reports a launcher process failure without echoing the command payload", async () => {
    await expect(launchProgressPanel({
      nodePath,
      cliPath: compiledCli,
      workspaceRoot: dangerousWorkspace,
      intervalMs: 250,
      color: true,
      platform: "darwin",
      env: { TMUX: "session" },
      runCommand: async () => ({ exitCode: 1 }),
    })).rejects.toThrow(/panel/i);
  });
});

describe("Workspace panel instance leases track real watcher liveness", () => {
  it("recognizes the current watcher process and permits a replacement after clean shutdown", async () => {
    const instanceDirectory = await temporaryInstanceDirectory();
    const first = await reserveProgressPanel({ workspaceRoot: "/workspace", instanceDirectory });
    if (first.state !== "reserved") throw new Error("Expected the first panel reservation.");
    const lease = await claimProgressPanel(first.reservation);
    expect(lease).toBeDefined();

    await expect(reserveProgressPanel({ workspaceRoot: "/workspace", instanceDirectory }))
      .resolves.toEqual({ state: "already_running" });

    await lease?.release();
    await expect(reserveProgressPanel({ workspaceRoot: "/workspace", instanceDirectory }))
      .resolves.toMatchObject({ state: "reserved" });
  });

  it("replaces a stale PID left by a watcher that no longer exists", async () => {
    const instanceDirectory = await temporaryInstanceDirectory();
    const first = await reserveProgressPanel({ workspaceRoot: "/workspace", instanceDirectory });
    if (first.state !== "reserved") throw new Error("Expected the first panel reservation.");
    const lease = await claimProgressPanel(first.reservation);
    expect(lease).toBeDefined();

    const record = JSON.parse(await readFile(first.reservation.filePath, "utf8")) as Record<string, unknown>;
    await writeFile(first.reservation.filePath, `${JSON.stringify({ ...record, pid: Number.MAX_SAFE_INTEGER })}\n`);

    await expect(reserveProgressPanel({ workspaceRoot: "/workspace", instanceDirectory }))
      .resolves.toMatchObject({ state: "reserved" });
  });
});
