import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  createTaskProgressService,
  type TaskProgressService,
  type TaskProgressServiceOptions,
} from "./task-progress-service.js";
import {
  renderTaskProgressTerminal,
  watchTaskProgress,
} from "./task-progress-terminal.js";
import {
  TerminalController,
  type TerminalInput,
} from "./task-progress-terminal-controller.js";
import {
  launchProgressPanel,
  type LaunchProgressPanelOptions,
  type ProgressPanelLauncher,
} from "./progress-panel-launcher.js";
import {
  claimProgressPanel,
  releaseProgressPanelReservation,
  reserveProgressPanel,
  type ProgressPanelLease,
  type ProgressPanelReservation,
} from "./progress-panel-instance.js";

interface WritableOutput {
  isTTY?: boolean;
  write(chunk: string | Uint8Array): boolean;
}

interface ProgressCliOptions {
  argv: string[];
  stdin?: TerminalInput;
  stdout?: WritableOutput;
  stderr?: WritableOutput;
  createService?: (options: TaskProgressServiceOptions) => Promise<TaskProgressService>;
  launchPanel?: (options: LaunchProgressPanelOptions) => Promise<void>;
  instanceDirectory?: string;
}

interface ParsedOptions {
  mode: "once" | "watch" | "panel" | "ensure-panel";
  workspaceRoot: string;
  taskId?: string;
  stateDirectory?: string;
  intervalMs: number;
  idleTimeoutMs?: number;
  color: "auto" | "always" | "never";
  help: boolean;
  launcher?: ProgressPanelLauncher | "auto";
  instanceFile?: string;
  instanceToken?: string;
}

const usage = `Usage: rv-workflow-progress --workspace <path> [--once | --watch | --panel | --ensure-panel]

Options:
  --workspace <path>   Project workspace whose progress should be displayed
  --task-id <id>       Display a specific task instead of the latest active task
  --state-dir <path>   Override the task-progress state directory
  --once               Print one snapshot and exit (default)
  --watch              Interactive TUI; redraw on revision changes; requires a TTY
  --panel              Open --watch in a tmux, Orca, iTerm2, or Terminal panel
  --ensure-panel       Keep one workspace panel open; start it only when absent
  --panel-launcher <x> Override auto detection: tmux, orca, iterm2, terminal
  --interval <ms>      Watch check interval from 100 to 60000 (default: 1000)
  --idle-timeout <ms>  Exit after completed work stays idle (ensure default: 30000)
  --color              Enable colors even when the parent sets NO_COLOR
  --no-color           Disable status colors
  --help               Show this help
`;

class OptionError extends Error {}

const ENSURED_PANEL_IDLE_TIMEOUT_MS = 30_000;

function takeValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new OptionError(`${option} requires a value.`);
  return value;
}

function parseOptions(argv: string[]): ParsedOptions {
  let once = false;
  let watch = false;
  let panel = false;
  let ensurePanel = false;
  let workspaceRoot: string | undefined;
  let taskId: string | undefined;
  let stateDirectory: string | undefined;
  let intervalMs = 1_000;
  let idleTimeoutMs: number | undefined;
  let color: ParsedOptions["color"] = "auto";
  let help = false;
  let launcher: ProgressPanelLauncher | "auto" | undefined;
  let instanceFile: string | undefined;
  let instanceToken: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--once") once = true;
    else if (argument === "--watch") watch = true;
    else if (argument === "--panel") panel = true;
    else if (argument === "--ensure-panel") ensurePanel = true;
    else if (argument === "--color") {
      if (color === "never") throw new OptionError("--color and --no-color cannot be used together.");
      color = "always";
    }
    else if (argument === "--no-color") {
      if (color === "always") throw new OptionError("--color and --no-color cannot be used together.");
      color = "never";
    }
    else if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--workspace") workspaceRoot = takeValue(argv, index++, argument);
    else if (argument === "--task-id") taskId = takeValue(argv, index++, argument);
    else if (argument === "--state-dir") stateDirectory = takeValue(argv, index++, argument);
    else if (argument === "--instance-file") instanceFile = takeValue(argv, index++, argument);
    else if (argument === "--instance-token") instanceToken = takeValue(argv, index++, argument);
    else if (argument === "--panel-launcher") {
      const value = takeValue(argv, index++, argument);
      if (!["auto", "tmux", "orca", "iterm2", "terminal"].includes(value)) {
        throw new OptionError("--panel-launcher must be auto, tmux, orca, iterm2, or terminal.");
      }
      launcher = value as ProgressPanelLauncher | "auto";
    }
    else if (argument === "--interval") {
      const value = takeValue(argv, index++, argument);
      intervalMs = Number(value);
      if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 60_000) {
        throw new OptionError("--interval must be an integer from 100 to 60000 milliseconds.");
      }
    } else if (argument === "--idle-timeout") {
      const value = takeValue(argv, index++, argument);
      idleTimeoutMs = Number(value);
      if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 10 || idleTimeoutMs > 600_000) {
        throw new OptionError("--idle-timeout must be an integer from 10 to 600000 milliseconds.");
      }
    } else {
      throw new OptionError(`Unknown option: ${argument ?? ""}`);
    }
  }

  const selectedModes = [once, watch, panel, ensurePanel].filter(Boolean).length;
  if (selectedModes > 1) {
    throw new OptionError("Only one of --once, --watch, --panel, and --ensure-panel may be used.");
  }
  if (launcher !== undefined && !panel && !ensurePanel) {
    throw new OptionError("--panel-launcher requires --panel or --ensure-panel.");
  }
  if (ensurePanel && taskId !== undefined) {
    throw new OptionError("--ensure-panel follows the latest active workspace task and cannot be used with --task-id.");
  }
  if ((instanceFile === undefined) !== (instanceToken === undefined)) {
    throw new OptionError("--instance-file and --instance-token must be used together.");
  }
  if ((instanceFile !== undefined || instanceToken !== undefined) && !watch) {
    throw new OptionError("--instance-file and --instance-token are internal --watch options.");
  }
  if (idleTimeoutMs !== undefined && !watch && !panel && !ensurePanel) {
    throw new OptionError("--idle-timeout requires --watch, --panel, or --ensure-panel.");
  }
  if (!help && !workspaceRoot) throw new OptionError("--workspace is required.");
  return {
    mode: ensurePanel ? "ensure-panel" : panel ? "panel" : watch ? "watch" : "once",
    workspaceRoot: workspaceRoot ?? ".",
    intervalMs,
    ...(idleTimeoutMs === undefined && !ensurePanel
      ? {}
      : { idleTimeoutMs: idleTimeoutMs ?? ENSURED_PANEL_IDLE_TIMEOUT_MS }),
    color,
    help,
    ...(taskId === undefined ? {} : { taskId }),
    ...(stateDirectory === undefined ? {} : { stateDirectory }),
    ...(launcher === undefined ? {} : { launcher }),
    ...(instanceFile === undefined ? {} : { instanceFile }),
    ...(instanceToken === undefined ? {} : { instanceToken }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Task progress could not be displayed.";
}

function colorEnabled(preference: ParsedOptions["color"]): boolean {
  return preference === "always" || (preference === "auto" && process.env.NO_COLOR === undefined);
}

export async function runProgressCli(options: ProgressCliOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const stdin = options.stdin ?? process.stdin;
  let parsed: ParsedOptions;
  try {
    parsed = parseOptions(options.argv);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n\n${usage}`);
    return 2;
  }

  if (parsed.help) {
    stdout.write(usage);
    return 0;
  }
  if (parsed.mode === "watch" && !stdout.isTTY) {
    stderr.write("--watch requires a TTY so frames do not accumulate in redirected output.\n");
    return 2;
  }

  if (parsed.mode === "panel" || parsed.mode === "ensure-panel") {
    let reservation: ProgressPanelReservation | undefined;
    try {
      if (parsed.mode === "ensure-panel") {
        const reservationResult = await reserveProgressPanel({
          workspaceRoot: parsed.workspaceRoot,
          ...(parsed.stateDirectory === undefined ? {} : { stateDirectory: parsed.stateDirectory }),
          ...(options.instanceDirectory === undefined ? {} : { instanceDirectory: options.instanceDirectory }),
        });
        if (reservationResult.state === "already_running") return 0;
        reservation = reservationResult.reservation;
      }
      await (options.launchPanel ?? launchProgressPanel)({
        nodePath: process.execPath,
        cliPath: fileURLToPath(import.meta.url),
        workspaceRoot: parsed.workspaceRoot,
        intervalMs: parsed.intervalMs,
        color: colorEnabled(parsed.color),
        ...(parsed.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: parsed.idleTimeoutMs }),
        ...(parsed.taskId === undefined ? {} : { taskId: parsed.taskId }),
        ...(parsed.stateDirectory === undefined ? {} : { stateDirectory: parsed.stateDirectory }),
        ...(parsed.launcher === undefined ? {} : { launcher: parsed.launcher }),
        ...(reservation === undefined ? {} : {
          instanceFile: reservation.filePath,
          instanceToken: reservation.token,
        }),
      });
      return 0;
    } catch (error) {
      if (reservation) await releaseProgressPanelReservation(reservation).catch(() => undefined);
      stderr.write(`${errorMessage(error)}\n`);
      return 1;
    }
  }

  const serviceFactory = options.createService ?? createTaskProgressService;
  let panelLease: ProgressPanelLease | undefined;
  try {
    if (parsed.instanceFile && parsed.instanceToken) {
      panelLease = await claimProgressPanel({
        filePath: parsed.instanceFile,
        token: parsed.instanceToken,
      });
      if (!panelLease) return 0;
    }
    const service = await serviceFactory({
      initializeStateDirectory: false,
      ...(parsed.stateDirectory === undefined ? {} : { stateDirectory: parsed.stateDirectory }),
    });
    const query = {
      workspaceRoot: parsed.workspaceRoot,
      ...(parsed.taskId === undefined ? {} : { taskId: parsed.taskId }),
    };

    if (parsed.mode === "once") {
      const result = await service.getTaskProgress(query);
      if (!result.ok) {
        stderr.write(`${result.error.message}\n`);
        return 1;
      }
      stdout.write(renderTaskProgressTerminal(result.snapshot, {
        interactive: false,
        color: false,
      }));
      return 0;
    }

    const interactiveInput = stdin.isTTY === true;
    let initialSnapshot: Parameters<typeof renderTaskProgressTerminal>[0] | undefined;
    let controller: TerminalController | undefined;
    let finish: (() => void) | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const finished = new Promise<void>((resolveFinished) => {
      finish = resolveFinished;
    });
    const watcher = await watchTaskProgress({
      service,
      ...query,
      intervalMs: parsed.intervalMs,
      onSnapshot(snapshot) {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
        if (parsed.idleTimeoutMs !== undefined && snapshot.task.status === "completed") {
          idleTimer = setTimeout(() => finish?.(), parsed.idleTimeoutMs);
        }
        initialSnapshot = snapshot;
        if (controller !== undefined) controller.updateSnapshot(snapshot);
        else if (!interactiveInput) {
          stdout.write(renderTaskProgressTerminal(snapshot, {
            interactive: true,
            color: colorEnabled(parsed.color),
          }));
        }
      },
      onError(message) {
        if (controller !== undefined) controller.reportRefreshError(message);
        else stderr.write(`Progress refresh failed: ${message}\n`);
      },
    });

    const stop = () => finish?.();
    try {
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      if (interactiveInput) {
        if (initialSnapshot === undefined) throw new Error("Task progress could not be read.");
        stdout.write("\u001B[?25l");
        controller = new TerminalController({
          input: stdin,
          service,
          workspaceRoot: parsed.workspaceRoot,
          snapshot: initialSnapshot,
          onRender(snapshot, view) {
            stdout.write(renderTaskProgressTerminal(snapshot, {
              interactive: true,
              color: colorEnabled(parsed.color),
              view,
            }));
          },
          onExit: stop,
          ...(parsed.taskId === undefined ? {} : { taskId: parsed.taskId }),
        });
        controller.start();
      }
      await finished;
      return 0;
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      watcher.stop();
      try {
        controller?.stop();
      } finally {
        if (interactiveInput) stdout.write("\u001B[?25h\n");
      }
    }
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n`);
    return 1;
  } finally {
    await panelLease?.release();
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && invokedPath === fileURLToPath(import.meta.url)) {
  void runProgressCli({ argv: process.argv.slice(2) }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
