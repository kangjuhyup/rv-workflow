import {
  STEP_STATUSES,
  type TaskProgressService,
  type TaskProgressSnapshot,
  type UpdateTaskStepInput,
} from "./task-progress-service.js";
import {
  defaultTerminalViewState,
  visibleTerminalSteps,
  type TerminalStatusFilter,
  type TerminalViewState,
} from "./task-progress-terminal-model.js";

export interface TerminalInput {
  isTTY?: boolean;
  setRawMode?(enabled: boolean): unknown;
  setEncoding?(encoding: BufferEncoding): unknown;
  on(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  off(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  resume?(): unknown;
  pause?(): unknown;
}

export interface TerminalControllerOptions {
  input: TerminalInput;
  service: Pick<TaskProgressService, "getTaskProgress" | "updateTaskStep">;
  workspaceRoot: string;
  taskId?: string;
  snapshot: TaskProgressSnapshot;
  onRender(snapshot: TaskProgressSnapshot, view: TerminalViewState): void;
  onExit(): void;
}

interface PendingMutation {
  label: string;
  input: Omit<UpdateTaskStepInput, "workspaceRoot" | "taskId" | "expectedRevision">;
}

const STATUS_FILTERS: readonly TerminalStatusFilter[] = ["all", ...STEP_STATUSES];
const MAX_INPUT_LENGTH = 2_000;

function copyView(view: TerminalViewState): TerminalViewState {
  return { ...view, expandedStepIds: [...view.expandedStepIds] };
}

function tokenizeCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | "\"" | undefined;
  let escaping = false;
  let started = false;

  for (const character of command.trim()) {
    if (escaping) {
      token += character;
      escaping = false;
      started = true;
    } else if (character === "\\") {
      escaping = true;
      started = true;
    } else if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else token += character;
      started = true;
    } else if (character === "'" || character === "\"") {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
    } else {
      token += character;
      started = true;
    }
  }
  if (quote !== undefined || escaping) return null;
  if (started) tokens.push(token);
  return tokens;
}

function commandLabel(name: string, stepId: string): string {
  return `:${name} ${stepId}`;
}

export class TerminalController {
  private snapshot: TaskProgressSnapshot;
  private view: TerminalViewState;
  private pendingMutation: PendingMutation | undefined;
  private started = false;
  private stopped = false;
  private exitRequested = false;
  private mutating = false;
  private inputQueue: Promise<void> = Promise.resolve();

  private readonly onData = (chunk: string | Buffer): void => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.inputQueue = this.inputQueue
      .then(() => this.handleInput(text))
      .catch((error: unknown) => {
        try {
          this.setNotice(error instanceof Error ? error.message : "Terminal input failed.", "error");
        } catch {
          // The CLI cleanup path still needs to run if rendering the error also fails.
        } finally {
          this.requestExit();
        }
      });
  };

  private readonly onInputError = (error: Error): void => {
    try {
      this.setNotice(`Terminal input failed: ${error.message}`, "error");
    } finally {
      this.requestExit();
    }
  };

  constructor(private readonly options: TerminalControllerOptions) {
    this.snapshot = options.snapshot;
    this.view = defaultTerminalViewState(options.snapshot);
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    if (this.options.input.isTTY) this.options.input.setRawMode?.(true);
    this.options.input.setEncoding?.("utf8");
    this.options.input.on("data", this.onData);
    this.options.input.on("error", this.onInputError);
    this.options.input.resume?.();
    this.emit();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    try {
      if (this.started) {
        this.options.input.off("data", this.onData);
        this.options.input.off("error", this.onInputError);
      }
    } finally {
      try {
        if (this.started) this.options.input.pause?.();
      } finally {
        if (this.started && this.options.input.isTTY) this.options.input.setRawMode?.(false);
      }
    }
  }

  async whenIdle(): Promise<void> {
    await this.inputQueue;
  }

  getViewState(): TerminalViewState {
    return copyView(this.view);
  }

  getSnapshot(): TaskProgressSnapshot {
    return this.snapshot;
  }

  updateSnapshot(snapshot: TaskProgressSnapshot): void {
    const taskChanged = snapshot.task.id !== this.snapshot.task.id;
    const previousRevision = this.snapshot.task.revision;
    this.snapshot = snapshot;
    if (taskChanged) {
      this.pendingMutation = undefined;
      this.view = defaultTerminalViewState(snapshot);
      this.setNotice("Now following the latest active task.", "info", false);
    } else if (
      snapshot.task.revision !== previousRevision
      && this.view.mode === "confirm"
      && this.pendingMutation !== undefined
    ) {
      this.view.confirmation = `Revision changed from ${previousRevision} to ${snapshot.task.revision}. Retry ${this.pendingMutation.label}? [y/N]`;
      this.setNotice("Latest snapshot loaded; review it before retrying.", "error", false);
      this.ensureSelection();
    } else {
      this.ensureSelection();
    }
    this.emit();
  }

  reportRefreshError(message: string): void {
    this.setNotice(`Refresh failed: ${message}`, "error");
  }

  async handleInput(chunk: string): Promise<void> {
    if (this.stopped || this.mutating) return;
    const normalized = chunk
      .replace(/\r\n/gu, "\r")
      .replace(/\u001B\[A/gu, "k")
      .replace(/\u001B\[B/gu, "j");
    for (const character of normalized) {
      if (this.stopped || this.exitRequested) return;
      if (character === "\u0003") {
        this.requestExit();
        return;
      }
      if (this.view.mode === "normal") await this.handleNormalInput(character);
      else if (this.view.mode === "confirm") await this.handleConfirmInput(character);
      else this.handleEditingInput(character);
    }
  }

  private async handleNormalInput(character: string): Promise<void> {
    if (character === "j") this.moveSelection(1);
    else if (character === "k") this.moveSelection(-1);
    else if (character === "\r" || character === "\n") this.toggleSelectedDetails();
    else if (character === "/") this.enterEditingMode("search");
    else if (character === ":") this.enterEditingMode("command");
    else if (character === "f") this.cycleStatusFilter();
    else if (character === "r") await this.refresh();
    else if (character === "?") {
      this.view.helpVisible = !this.view.helpVisible;
      this.emit();
    } else if (character === "q") this.requestExit();
  }

  private async handleConfirmInput(character: string): Promise<void> {
    if (character === "y" || character === "Y" || character === "\r" || character === "\n") {
      await this.applyPendingMutation();
    } else if (character === "n" || character === "N" || character === "\u001B") {
      this.pendingMutation = undefined;
      this.returnToNormal("Command cancelled.", "info");
    }
  }

  private handleEditingInput(character: string): void {
    if (character === "\u001B") {
      this.returnToNormal(undefined, "info");
      return;
    }
    if (character === "\u007F" || character === "\b") {
      this.view.inputBuffer = Array.from(this.view.inputBuffer).slice(0, -1).join("");
      this.emit();
      return;
    }
    if (character === "\r" || character === "\n") {
      if (this.view.mode === "search") {
        this.view.searchQuery = this.view.inputBuffer;
        this.returnToNormal(undefined, "info");
        this.ensureSelection();
        this.emit();
      } else {
        this.executeCommand(this.view.inputBuffer);
      }
      return;
    }
    if (/^[^\u0000-\u001F\u007F]$/u.test(character) && this.view.inputBuffer.length < MAX_INPUT_LENGTH) {
      this.view.inputBuffer += character;
      this.emit();
    }
  }

  private enterEditingMode(mode: "search" | "command"): void {
    this.view.mode = mode;
    this.view.inputBuffer = mode === "search" ? this.view.searchQuery : "";
    this.view.confirmation = undefined;
    this.view.notice = undefined;
    this.emit();
  }

  private returnToNormal(
    notice: string | undefined,
    tone: TerminalViewState["noticeTone"],
  ): void {
    this.view.mode = "normal";
    this.view.inputBuffer = "";
    this.view.confirmation = undefined;
    this.setNotice(notice, tone, false);
    this.emit();
  }

  private moveSelection(offset: number): void {
    const visible = visibleTerminalSteps(this.snapshot, this.view);
    if (visible.length === 0) return;
    const currentIndex = visible.findIndex((step) => step.id === this.view.selectedStepId);
    const base = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = Math.max(0, Math.min(visible.length - 1, base + offset));
    this.view.selectedStepId = visible[nextIndex]?.id;
    this.emit();
  }

  private toggleSelectedDetails(): void {
    const stepId = this.view.selectedStepId;
    if (stepId === undefined) return;
    const expanded = new Set(this.view.expandedStepIds);
    if (expanded.has(stepId)) expanded.delete(stepId);
    else expanded.add(stepId);
    this.view.expandedStepIds = [...expanded];
    this.emit();
  }

  private cycleStatusFilter(): void {
    const current = STATUS_FILTERS.indexOf(this.view.statusFilter);
    this.view.statusFilter = STATUS_FILTERS[(current + 1) % STATUS_FILTERS.length] ?? "all";
    this.ensureSelection();
    this.setNotice(`Status filter: ${this.view.statusFilter}`, "info", false);
    this.emit();
  }

  private ensureSelection(): void {
    const visible = visibleTerminalSteps(this.snapshot, this.view);
    if (!visible.some((step) => step.id === this.view.selectedStepId)) {
      this.view.selectedStepId = visible[0]?.id;
    }
  }

  private async refresh(): Promise<void> {
    const result = await this.options.service.getTaskProgress({
      workspaceRoot: this.options.workspaceRoot,
      ...(this.options.taskId === undefined ? {} : { taskId: this.options.taskId }),
    });
    if (!result.ok) {
      this.reportRefreshError(result.error.message);
      return;
    }
    this.updateSnapshot(result.snapshot);
    this.setNotice(`Refreshed revision ${result.revision}.`, "success");
  }

  private executeCommand(command: string): void {
    const tokens = tokenizeCommand(command);
    if (tokens === null) {
      this.returnToNormal("Command contains an unfinished quote or escape.", "error");
      return;
    }
    const [name, ...args] = tokens;
    if (name === undefined) {
      this.returnToNormal(undefined, "info");
      return;
    }
    if (name === "filter") {
      this.executeFilterCommand(args);
      return;
    }
    if (name === "refresh") {
      this.returnToNormal(undefined, "info");
      void this.refresh().catch((error: unknown) => {
        this.reportRefreshError(error instanceof Error ? error.message : "Task progress could not be refreshed.");
      });
      return;
    }
    if (name === "quit") {
      this.requestExit();
      return;
    }
    if (name === "help") {
      this.view.helpVisible = true;
      this.returnToNormal(undefined, "info");
      return;
    }
    if (name === "start" || name === "done" || name === "block" || name === "skip") {
      const pending = this.parseMutation(name, args);
      if (typeof pending === "string") {
        this.returnToNormal(pending, "error");
        return;
      }
      this.pendingMutation = pending;
      this.view.mode = "confirm";
      this.view.inputBuffer = "";
      this.view.confirmation = `Apply ${pending.label} at revision ${this.snapshot.task.revision}? [y/N]`;
      this.view.notice = undefined;
      this.emit();
      return;
    }
    this.returnToNormal(`Unknown command: ${name}. Press ? for allowed commands.`, "error");
  }

  private executeFilterCommand(args: string[]): void {
    const [filter, ...extra] = args;
    if (extra.length > 0 || !STATUS_FILTERS.includes(filter as TerminalStatusFilter)) {
      this.returnToNormal("Usage: :filter all|pending|in_progress|blocked|completed|skipped", "error");
      return;
    }
    this.view.statusFilter = filter as TerminalStatusFilter;
    this.ensureSelection();
    this.returnToNormal(`Status filter: ${filter}`, "success");
  }

  private parseMutation(
    name: "start" | "done" | "block" | "skip",
    args: string[],
  ): PendingMutation | string {
    const [stepId, ...rest] = args;
    if (stepId === undefined || !this.snapshot.steps.some((step) => step.id === stepId)) {
      return `Unknown step. Usage: :${name} <step-id>${name === "block" ? " --reason <text>" : ""}`;
    }
    const label = commandLabel(name, stepId);
    if (name === "start") {
      if (rest.length > 0) return "Usage: :start <step-id>";
      return { label, input: { stepId, status: "in_progress" } };
    }
    if (name === "skip") {
      if (rest.length > 0) return "Usage: :skip <step-id>";
      return { label, input: { stepId, status: "skipped" } };
    }
    if (name === "done") {
      const summary = rest.join(" ").trim();
      return {
        label,
        input: {
          stepId,
          status: "completed",
          ...(summary === "" ? {} : { summary }),
        },
      };
    }
    if (rest[0] !== "--reason" || rest.length < 2) {
      return "Usage: :block <step-id> --reason <text>";
    }
    const blockedReason = rest.slice(1).join(" ").trim();
    if (blockedReason === "") return "Blocking requires a non-empty reason.";
    return { label, input: { stepId, status: "blocked", blockedReason } };
  }

  private async applyPendingMutation(): Promise<void> {
    const pending = this.pendingMutation;
    if (pending === undefined) {
      this.returnToNormal("No command is awaiting confirmation.", "error");
      return;
    }
    this.mutating = true;
    this.view.notice = `Applying ${pending.label}…`;
    this.view.noticeTone = "info";
    this.emit();
    const expectedRevision = this.snapshot.task.revision;
    try {
      const result = await this.options.service.updateTaskStep({
        workspaceRoot: this.options.workspaceRoot,
        taskId: this.snapshot.task.id,
        expectedRevision,
        ...pending.input,
      });
      if (result.ok) {
        this.snapshot = result.snapshot;
        this.pendingMutation = undefined;
        this.ensureSelection();
        this.returnToNormal(`${pending.label} completed at revision ${result.revision}.`, "success");
        return;
      }
      if (result.error.code === "revision_conflict") {
        await this.prepareConflictRetry(pending, expectedRevision);
        return;
      }
      this.pendingMutation = undefined;
      this.returnToNormal(result.error.message, "error");
    } finally {
      this.mutating = false;
    }
  }

  private async prepareConflictRetry(pending: PendingMutation, staleRevision: number): Promise<void> {
    const latest = await this.options.service.getTaskProgress({
      workspaceRoot: this.options.workspaceRoot,
      taskId: this.snapshot.task.id,
    });
    if (!latest.ok) {
      this.pendingMutation = undefined;
      this.returnToNormal(`Revision conflict; latest snapshot could not be read: ${latest.error.message}`, "error");
      return;
    }
    this.snapshot = latest.snapshot;
    this.ensureSelection();
    this.pendingMutation = pending;
    this.view.mode = "confirm";
    this.view.inputBuffer = "";
    this.view.confirmation = `Revision changed from ${staleRevision} to ${latest.revision}. Retry ${pending.label}? [y/N]`;
    this.view.notice = "Latest snapshot loaded; review it before retrying.";
    this.view.noticeTone = "error";
    this.emit();
  }

  private setNotice(
    notice: string | undefined,
    tone: TerminalViewState["noticeTone"],
    emit = true,
  ): void {
    this.view.notice = notice;
    this.view.noticeTone = tone;
    if (emit) this.emit();
  }

  private emit(): void {
    if (!this.stopped) this.options.onRender(this.snapshot, copyView(this.view));
  }

  private requestExit(): void {
    if (this.exitRequested) return;
    this.exitRequested = true;
    this.options.onExit();
  }
}
