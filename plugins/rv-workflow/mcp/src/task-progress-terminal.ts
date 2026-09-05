import type {
  TaskProgressService,
  TaskProgressSnapshot,
} from "./task-progress-service.js";
import {
  visibleTerminalSteps,
  type TerminalViewState,
} from "./task-progress-terminal-model.js";

export interface TerminalRenderOptions {
  interactive: boolean;
  color: boolean;
  view?: TerminalViewState;
}

export interface WatchTaskProgressOptions {
  service: Pick<TaskProgressService, "getTaskProgress">;
  workspaceRoot: string;
  taskId?: string;
  intervalMs?: number;
  onSnapshot(snapshot: TaskProgressSnapshot): void;
  onError?(message: string): void;
}

export interface TaskProgressWatcher {
  stop(): void;
}

const statusPresentation = {
  pending: { icon: "○", color: 90 },
  in_progress: { icon: "◐", color: 36 },
  blocked: { icon: "!", color: 31 },
  completed: { icon: "✓", color: 32 },
  skipped: { icon: "−", color: 90 },
} as const;

const color = {
  red: 31,
  green: 32,
  yellow: 33,
  magenta: 35,
  cyan: 36,
  brightWhite: 97,
} as const;

const style = {
  bold: 1,
  dim: 2,
} as const;

function safeText(value: string): string {
  return value
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function safeInput(value: string): string {
  return value
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "");
}

function paint(value: string, codes: number | readonly number[], enabled: boolean): string {
  const sequence = Array.isArray(codes) ? codes.join(";") : codes;
  return enabled ? `\u001B[${sequence}m${value}\u001B[0m` : value;
}

function progressBar(percent: number | null): string {
  if (percent === null) return "[----------]";
  const completed = Math.round(Math.max(0, Math.min(100, percent)) / 10);
  return `[${"#".repeat(completed)}${"-".repeat(10 - completed)}]`;
}

export function renderTaskProgressTerminal(
  snapshot: TaskProgressSnapshot,
  options: TerminalRenderOptions,
): string {
  const ansi = options.interactive && options.color;
  const taskStatus = statusPresentation[snapshot.task.status];
  const progress = snapshot.progress.percent === null
    ? snapshot.progress.label
    : `${snapshot.progress.percent}% · ${snapshot.progress.label}`;
  const lines = [
    `${paint("RV Workflow", [style.bold, color.cyan], ansi)} ${paint(`· ${safeText(snapshot.workspaceLabel)}`, style.dim, ansi)}`,
    `  ${paint(safeText(snapshot.task.title), [style.bold, color.brightWhite], ansi)}`,
    `  ${paint("Status:", style.dim, ansi)} ${paint(snapshot.task.status, taskStatus.color, ansi)} ${paint(`· Revision ${snapshot.task.revision}`, style.dim, ansi)}`,
    `  ${paint("Progress:", style.dim, ansi)} ${paint(progressBar(snapshot.progress.percent), color.cyan, ansi)} ${safeText(progress)}`,
    "",
    paint("Steps", [style.bold, color.cyan], ansi),
  ];

  const steps = options.view === undefined
    ? snapshot.steps
    : visibleTerminalSteps(snapshot, options.view);
  for (const step of steps) {
    const presentation = statusPresentation[step.status];
    const icon = paint(presentation.icon, presentation.color, ansi);
    const selected = options.view?.selectedStepId === step.id;
    const marker = options.view === undefined ? "  " : selected ? `${paint("›", color.cyan, ansi)} ` : "  ";
    lines.push(
      `${marker}${icon} ${paint(safeText(step.role), [style.bold, color.magenta], ansi)} · ${paint(safeText(step.title), style.bold, ansi)} ${paint(`[${safeText(step.status)}]`, presentation.color, ansi)}`,
    );
    const details = [
      ...(step.owner ? [{ label: "Owner", value: safeText(step.owner), valueColor: color.cyan }] : []),
      ...(step.summary ? [{ label: "Summary", value: safeText(step.summary) }] : []),
      ...(step.blockedReason ? [{ label: "Blocked", value: safeText(step.blockedReason), valueColor: color.red }] : []),
    ];
    const showDetails = options.view === undefined || options.view.expandedStepIds.includes(step.id);
    if (showDetails) details.forEach((detail, index) => {
      const branch = index === details.length - 1 ? "└─" : "├─";
      const value = detail.valueColor === undefined
        ? detail.value
        : paint(detail.value, detail.valueColor, ansi);
      lines.push(`      ${paint(branch, style.dim, ansi)} ${paint(`${detail.label}:`, style.dim, ansi)} ${value}`);
    });
  }

  if (steps.length === 0) {
    lines.push(`  ${paint("No steps match the active search and status filter.", style.dim, ansi)}`);
  }

  if (snapshot.nextRunnableStep) {
    lines.push(
      "",
      paint("Next", [style.bold, color.cyan], ansi),
      `  ${paint("→", color.cyan, ansi)} ${paint(safeText(snapshot.nextRunnableStep.role), [style.bold, color.magenta], ansi)} · ${paint(safeText(snapshot.nextRunnableStep.title), style.bold, ansi)}`,
    );
  }
  if (snapshot.isStale) {
    lines.push("", paint("Warning: progress may be stale.", color.yellow, ansi));
  }
  lines.push("", paint(`Updated: ${safeText(snapshot.task.updatedAt)}`, style.dim, ansi));

  if (options.view !== undefined) {
    const search = options.view.searchQuery === "" ? "none" : safeText(options.view.searchQuery);
    lines.push(
      "",
      paint("─".repeat(48), style.dim, ansi),
      paint(`Filter: ${options.view.statusFilter} · Search: ${search}`, style.dim, ansi),
    );
    if (options.view.helpVisible) {
      lines.push(
        paint("j/k move · Enter details · / search · f status filter · r refresh", color.cyan, ansi),
        paint("? help · q quit · : command", color.cyan, ansi),
        paint(":start STEP · :done STEP \"SUMMARY\" · :block STEP --reason \"REASON\" · :skip STEP", color.cyan, ansi),
        paint(":filter STATUS · :refresh · :help · :quit", color.cyan, ansi),
      );
    }
    if (options.view.notice !== undefined) {
      const noticeColor = options.view.noticeTone === "error"
        ? color.red
        : options.view.noticeTone === "success" ? color.green : color.yellow;
      lines.push(paint(safeText(options.view.notice), noticeColor, ansi));
    }
    if (options.view.mode === "search") {
      lines.push(`/ ${safeInput(options.view.inputBuffer)}_`);
    } else if (options.view.mode === "command") {
      lines.push(`: ${safeInput(options.view.inputBuffer)}_`);
    } else if (options.view.mode === "confirm") {
      lines.push(paint(safeText(options.view.confirmation ?? "Confirm command? [y/N]"), color.yellow, ansi));
    } else if (!options.view.helpVisible) {
      lines.push(paint("j/k move · Enter details · / search · f filter · r refresh · ? help · q quit · : command", style.dim, ansi));
    }
  }

  const frame = `${lines.join("\n")}\n`;
  return options.interactive ? `\u001B[2J\u001B[H${frame}` : frame;
}

function readErrorMessage(result: Awaited<ReturnType<TaskProgressService["getTaskProgress"]>>): string {
  return result.ok ? "Task progress could not be read." : result.error.message;
}

export async function watchTaskProgress(
  options: WatchTaskProgressOptions,
): Promise<TaskProgressWatcher> {
  const intervalMs = options.intervalMs ?? 1_000;
  let stopped = false;
  let reading = false;
  let lastTaskId: string | undefined;
  let lastRevision = 0;
  let lastError: string | undefined;

  const reportError = (message: string): void => {
    if (message === lastError) return;
    lastError = message;
    options.onError?.(message);
  };

  const refresh = async (initial: boolean): Promise<void> => {
    if (stopped || reading) return;
    reading = true;
    try {
      const result = await options.service.getTaskProgress({
        workspaceRoot: options.workspaceRoot,
        ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
      });
      if (stopped) return;
      if (!result.ok) {
        const message = readErrorMessage(result);
        if (initial) throw new Error(message);
        reportError(message);
        return;
      }
      lastError = undefined;
      const changed = result.task.id !== lastTaskId || result.revision > lastRevision;
      if (changed) {
        lastTaskId = result.task.id;
        lastRevision = result.revision;
        options.onSnapshot(result.snapshot);
      }
    } finally {
      reading = false;
    }
  };

  await refresh(true);
  const timer = setInterval(() => {
    void refresh(false).catch((error: unknown) => {
      if (stopped) return;
      reportError(error instanceof Error ? error.message : "Task progress could not be refreshed.");
    });
  }, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
