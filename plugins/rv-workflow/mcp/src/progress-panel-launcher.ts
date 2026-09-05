import { spawn } from "node:child_process";

export type ProgressPanelLauncher = "tmux" | "orca" | "iterm2" | "terminal";
export type DetectedProgressPanelLauncher = ProgressPanelLauncher | "unsupported";

type Environment = Readonly<Record<string, string | undefined>>;

export interface DetectProgressPanelLauncherOptions {
  platform?: NodeJS.Platform;
  env?: Environment;
  launcher?: ProgressPanelLauncher | "auto";
}

export interface RunCommandResult {
  exitCode: number;
}

export type RunCommand = (file: string, args: string[]) => Promise<RunCommandResult>;

export interface LaunchProgressPanelOptions extends DetectProgressPanelLauncherOptions {
  nodePath: string;
  cliPath: string;
  workspaceRoot: string;
  taskId?: string;
  stateDirectory?: string;
  intervalMs: number;
  idleTimeoutMs?: number;
  color: boolean;
  instanceFile?: string;
  instanceToken?: string;
  runCommand?: RunCommand;
}

const terminalJxa = String.raw`function run(argv) {
  function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
  }
  const terminal = Application("Terminal");
  terminal.activate();
  terminal.doScript(argv.map(shellQuote).join(" "));
}`;

const itermAppleScript = `on run argv
  set watcherCommand to item 1 of argv
  tell application "iTerm2"
    activate
    tell current session of current window
      split vertically with same profile command watcherCommand
    end tell
  end tell
end run`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function watcherArguments(options: LaunchProgressPanelOptions): string[] {
  return [
    options.nodePath,
    options.cliPath,
    "--watch",
    "--workspace",
    options.workspaceRoot,
    ...(options.taskId === undefined ? [] : ["--task-id", options.taskId]),
    ...(options.stateDirectory === undefined ? [] : ["--state-dir", options.stateDirectory]),
    "--interval",
    String(options.intervalMs),
    options.color ? "--color" : "--no-color",
    ...(options.idleTimeoutMs === undefined ? [] : ["--idle-timeout", String(options.idleTimeoutMs)]),
    ...(options.instanceFile === undefined ? [] : ["--instance-file", options.instanceFile]),
    ...(options.instanceToken === undefined ? [] : ["--instance-token", options.instanceToken]),
  ];
}

function watcherShellCommand(options: LaunchProgressPanelOptions): string {
  return watcherArguments(options).map(shellQuote).join(" ");
}

function defaultRunCommand(file: string, args: string[]): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ exitCode: code ?? 1 }));
  });
}

export function detectProgressPanelLauncher(
  options: DetectProgressPanelLauncherOptions = {},
): DetectedProgressPanelLauncher {
  if (options.launcher !== undefined && options.launcher !== "auto") return options.launcher;

  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (env.TMUX) return "tmux";
  if (env.TERM_PROGRAM === "Orca") return "orca";
  if (platform === "darwin" && env.TERM_PROGRAM === "iTerm.app") return "iterm2";
  if (platform === "darwin") return "terminal";
  return "unsupported";
}

function resolveOrcaExecutable(env: Environment): string {
  if (env.ORCA_CLI_COMMAND) return env.ORCA_CLI_COMMAND;
  if (env.ORCA_DEV_REPO_ROOT) return "orca-dev";
  return "orca";
}

export async function launchProgressPanel(options: LaunchProgressPanelOptions): Promise<void> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const launcher = detectProgressPanelLauncher({
    platform,
    env,
    ...(options.launcher === undefined ? {} : { launcher: options.launcher }),
  });

  if (
    launcher === "unsupported"
    || ((launcher === "iterm2" || launcher === "terminal") && platform !== "darwin")
  ) {
    throw new Error("The task progress panel requires tmux, an Orca terminal, or macOS.");
  }

  const shellCommand = watcherShellCommand(options);
  let file: string;
  let args: string[];

  if (launcher === "tmux") {
    file = "tmux";
    args = ["split-window", "-h", "-c", options.workspaceRoot, shellCommand];
  } else if (launcher === "orca") {
    file = resolveOrcaExecutable(env);
    args = [
      "terminal",
      "split",
      "--direction",
      "horizontal",
      "--command",
      `exec ${shellCommand}`,
      "--json",
    ];
  } else if (launcher === "iterm2") {
    file = "/usr/bin/osascript";
    args = ["-e", itermAppleScript, "--", shellCommand];
  } else {
    file = "/usr/bin/osascript";
    args = ["-l", "JavaScript", "-e", terminalJxa, "--", ...watcherArguments(options)];
  }

  try {
    const result = await (options.runCommand ?? defaultRunCommand)(file, args);
    if (result.exitCode !== 0) throw new Error("launcher exited unsuccessfully");
  } catch {
    throw new Error("Unable to open the task progress panel.");
  }
}
