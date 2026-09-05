import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runProgressCli } from "../src/progress-cli.js";
import {
  TerminalController,
  type TerminalInput,
} from "../src/task-progress-terminal-controller.js";
import { defaultTerminalViewState } from "../src/task-progress-terminal-model.js";
import {
  renderTaskProgressTerminal,
  watchTaskProgress,
} from "../src/task-progress-terminal.js";
import {
  createTaskProgressService,
  type TaskProgressResult,
  type TaskProgressService,
  type TaskProgressSnapshot,
} from "../src/task-progress-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function snapshot(overrides: Partial<TaskProgressSnapshot> = {}): TaskProgressSnapshot {
  return {
    schemaVersion: 1,
    workspaceKey: "workspace-key",
    workspaceLabel: "product-workspace",
    task: {
      id: "terminal-dashboard",
      title: "Deliver the terminal dashboard",
      status: "blocked",
      revision: 4,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:01:00.000Z",
    },
    progress: {
      completedSteps: 1,
      actionableSteps: 2,
      percent: 50,
      label: "1 / 2 actionable steps",
    },
    steps: [
      {
        id: "plan",
        title: "Approve the dashboard plan",
        role: "planner",
        status: "completed",
        dependsOn: [],
      },
      {
        id: "build",
        title: "Build the terminal renderer",
        role: "backend",
        status: "blocked",
        dependsOn: ["plan"],
        blockedReason: "Waiting for terminal API approval",
      },
    ],
    events: [],
    nextRunnableStep: null,
    isStale: false,
    ...overrides,
  };
}

function result(current: TaskProgressSnapshot): TaskProgressResult {
  return {
    ok: true,
    task: current.task,
    revision: current.task.revision,
    snapshot: current,
  };
}

function writableBuffer(interactive = false) {
  let contents = "";
  return {
    get contents() {
      return contents;
    },
    isTTY: interactive,
    write(chunk: string | Uint8Array) {
      contents += String(chunk);
      return true;
    },
  };
}

class FakeTerminalInput extends EventEmitter implements TerminalInput {
  rawModes: boolean[] = [];
  encodings: BufferEncoding[] = [];
  resumed = false;
  paused = false;

  constructor(readonly isTTY: boolean) {
    super();
  }

  setRawMode(enabled: boolean): void {
    this.rawModes.push(enabled);
  }

  setEncoding(encoding: BufferEncoding): void {
    this.encodings.push(encoding);
  }

  resume(): void {
    this.resumed = true;
  }

  pause(): void {
    this.paused = true;
  }
}

describe("Terminal task-progress output remains useful without terminal styling", () => {
  it("shows the task title, task status, progress, role-owned steps, and blocked reason in plain output", () => {
    const output = renderTaskProgressTerminal(snapshot(), {
      interactive: false,
      color: false,
    });

    expect(output).not.toMatch(/\u001B\[/u);
    expect(output).toContain("Deliver the terminal dashboard");
    expect(output).toMatch(/status:\s*blocked/iu);
    expect(output).toContain("1 / 2 actionable steps");
    expect(output).toContain("50%");
    expect(output).toMatch(/planner.*Approve the dashboard plan/iu);
    expect(output).toMatch(/backend.*Build the terminal renderer/iu);
    expect(output).toContain("Waiting for terminal API approval");
    expect(output).toContain("\n  Deliver the terminal dashboard\n");
    expect(output).toContain("\n  ✓ planner · Approve the dashboard plan [completed]\n");
    expect(output).toContain("\n  ! backend · Build the terminal renderer [blocked]\n");
    expect(output).toContain("\n      └─ Blocked: Waiting for terminal API approval\n");
  });

  it("labels each owner when independent backend and frontend steps are active in parallel", () => {
    const output = renderTaskProgressTerminal(snapshot({
      task: { ...snapshot().task, status: "in_progress" },
      steps: [
        { id: "api", title: "Build the API", role: "backend", status: "in_progress", dependsOn: [], owner: "backend-agent" },
        { id: "ui", title: "Build the interface", role: "frontend", status: "in_progress", dependsOn: [], owner: "frontend-agent" },
      ],
    }), { interactive: false, color: false });

    expect(output).toMatch(/backend[\s\S]*Build the API[\s\S]*Owner: backend-agent/iu);
    expect(output).toMatch(/frontend[\s\S]*Build the interface[\s\S]*Owner: frontend-agent/iu);
  });
});

describe("Interactive terminal styling reinforces the information hierarchy", () => {
  it("colors headings, task text, roles, statuses, and detail values by semantic purpose", () => {
    const output = renderTaskProgressTerminal(snapshot({
      steps: [{
        id: "build",
        title: "Build the terminal renderer",
        role: "backend",
        status: "blocked",
        dependsOn: [],
        owner: "backend-agent",
        summary: "Implementing readable output",
        blockedReason: "Waiting for terminal API approval",
      }],
    }), { interactive: true, color: true });

    expect(output).toContain("\u001B[1;36mRV Workflow\u001B[0m");
    expect(output).toContain("\u001B[1;97mDeliver the terminal dashboard\u001B[0m");
    expect(output).toContain("\u001B[1;35mbackend\u001B[0m");
    expect(output).toContain("\u001B[31m[blocked]\u001B[0m");
    expect(output).toContain("\u001B[36mbackend-agent\u001B[0m");
    expect(output).toContain("\u001B[31mWaiting for terminal API approval\u001B[0m");
  });

  it("uses tree branches to keep multiple step details visually grouped", () => {
    const output = renderTaskProgressTerminal(snapshot({
      steps: [{
        id: "build",
        title: "Build the terminal renderer",
        role: "backend",
        status: "blocked",
        dependsOn: [],
        owner: "backend-agent",
        summary: "Implementing readable output",
        blockedReason: "Waiting for terminal API approval",
      }],
    }), { interactive: true, color: false });

    expect(output).toContain("\n      ├─ Owner: backend-agent\n");
    expect(output).toContain("\n      ├─ Summary: Implementing readable output\n");
    expect(output).toContain("\n      └─ Blocked: Waiting for terminal API approval\n");
  });

  it("renders controller-owned selection, collapsed details, filters, and the command input line", () => {
    const current = snapshot();
    const view = {
      ...defaultTerminalViewState(current),
      selectedStepId: "build",
      mode: "command" as const,
      inputBuffer: "filter blocked",
    };

    const collapsed = renderTaskProgressTerminal(current, {
      interactive: true,
      color: false,
      view,
    });

    expect(collapsed).toContain("› ! backend · Build the terminal renderer [blocked]");
    expect(collapsed).not.toContain("Waiting for terminal API approval");
    expect(collapsed).toContain(": filter blocked_");

    const expanded = renderTaskProgressTerminal(current, {
      interactive: true,
      color: false,
      view: { ...view, expandedStepIds: ["build"] },
    });
    expect(expanded).toContain("Waiting for terminal API approval");
  });
});

describe("The terminal controller keeps input handling separate from rendering", () => {
  it("uses raw mode only for a TTY and restores it when stopped", () => {
    const tty = new FakeTerminalInput(true);
    const pipe = new FakeTerminalInput(false);
    const service = {
      getTaskProgress: vi.fn(),
      updateTaskStep: vi.fn(),
    } as unknown as TaskProgressService;
    const create = (input: FakeTerminalInput) => new TerminalController({
      input,
      service,
      workspaceRoot: "/workspace",
      snapshot: snapshot(),
      onRender: vi.fn(),
      onExit: vi.fn(),
    });

    const ttyController = create(tty);
    ttyController.start();
    ttyController.stop();
    const pipeController = create(pipe);
    pipeController.start();
    pipeController.stop();

    expect(tty.rawModes).toEqual([true, false]);
    expect(tty.encodings).toEqual(["utf8"]);
    expect(tty.resumed).toBe(true);
    expect(tty.paused).toBe(true);
    expect(pipe.rawModes).toEqual([]);
  });

  it("navigates, expands details, searches, and filters through explicit modes", async () => {
    const input = new FakeTerminalInput(true);
    const states: ReturnType<TerminalController["getViewState"]>[] = [];
    const controller = new TerminalController({
      input,
      service: {
        getTaskProgress: vi.fn(),
        updateTaskStep: vi.fn(),
      } as unknown as TaskProgressService,
      workspaceRoot: "/workspace",
      snapshot: snapshot(),
      onRender: (_current, view) => states.push(view),
      onExit: vi.fn(),
    });
    controller.start();

    await controller.handleInput("j\r/renderer\r:filter blocked\r");

    const view = controller.getViewState();
    expect(view.mode).toBe("normal");
    expect(view.selectedStepId).toBe("build");
    expect(view.expandedStepIds).toContain("build");
    expect(view.searchQuery).toBe("renderer");
    expect(view.statusFilter).toBe("blocked");
    expect(states.some((state) => state.mode === "search")).toBe(true);
    expect(states.some((state) => state.mode === "command")).toBe(true);
    controller.stop();
  });

  it("confirms allowed mutations and uses the displayed revision as expectedRevision", async () => {
    const initial = snapshot({
      task: { ...snapshot().task, status: "in_progress", revision: 4 },
      steps: snapshot().steps.map((step) => {
        if (step.id !== "build") return step;
        const { blockedReason: _blockedReason, ...unblocked } = step;
        return { ...unblocked, status: "in_progress" as const };
      }),
    });
    const updated = snapshot({
      task: { ...initial.task, revision: 5 },
      steps: initial.steps.map((step) => step.id === "build"
        ? { ...step, status: "completed" as const, summary: "Renderer implemented" }
        : step),
    });
    const updateTaskStep = vi.fn(async () => result(updated));
    const controller = new TerminalController({
      input: new FakeTerminalInput(true),
      service: {
        getTaskProgress: vi.fn(),
        updateTaskStep,
      } as unknown as TaskProgressService,
      workspaceRoot: "/workspace",
      snapshot: initial,
      onRender: vi.fn(),
      onExit: vi.fn(),
    });

    await controller.handleInput(":done build \"Renderer implemented\"\r");
    expect(controller.getViewState().mode).toBe("confirm");
    expect(updateTaskStep).not.toHaveBeenCalled();
    await controller.handleInput("y");

    expect(updateTaskStep).toHaveBeenCalledWith({
      workspaceRoot: "/workspace",
      taskId: "terminal-dashboard",
      stepId: "build",
      status: "completed",
      summary: "Renderer implemented",
      expectedRevision: 4,
    });
    expect(controller.getSnapshot().task.revision).toBe(5);
    expect(controller.getViewState().mode).toBe("normal");
  });

  it("applies an allowed command through the real task-progress service", async () => {
    const root = await mkdtemp(join(tmpdir(), "rv-workflow-terminal-controller-"));
    temporaryDirectories.push(root);
    const workspaceRoot = join(root, "product-workspace");
    const stateDirectory = join(root, "state");
    await mkdir(workspaceRoot, { recursive: true });
    const service = await createTaskProgressService({ stateDirectory });
    const created = await service.createTask({
      workspaceRoot,
      title: "Mutate from the terminal",
      idempotencyKey: "terminal-controller-mutation",
      steps: [{ id: "build", title: "Build the renderer", role: "backend", dependsOn: [] }],
    });
    if (!created.ok) throw new Error(created.error.message);
    const controller = new TerminalController({
      input: new FakeTerminalInput(true),
      service,
      workspaceRoot,
      taskId: created.task.id,
      snapshot: created.snapshot,
      onRender: vi.fn(),
      onExit: vi.fn(),
    });

    await controller.handleInput(":start build\ry");

    const stored = await service.getTaskProgress({ workspaceRoot, taskId: created.task.id });
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error(stored.error.message);
    expect(stored.revision).toBe(2);
    expect(stored.snapshot.steps[0]?.status).toBe("in_progress");
  });

  it.each([
    [":start build", { status: "in_progress" }],
    [":block build --reason \"Waiting for API approval\"", { status: "blocked", blockedReason: "Waiting for API approval" }],
    [":skip build", { status: "skipped" }],
  ] as const)("maps %s through the mutation command registry", async (command, expected) => {
    const initial = snapshot({ task: { ...snapshot().task, revision: 4 } });
    const updated = snapshot({ task: { ...initial.task, revision: 5 }, steps: initial.steps });
    const updateTaskStep = vi.fn(async () => result(updated));
    const controller = new TerminalController({
      input: new FakeTerminalInput(true),
      service: {
        getTaskProgress: vi.fn(),
        updateTaskStep,
      } as unknown as TaskProgressService,
      workspaceRoot: "/workspace",
      snapshot: initial,
      onRender: vi.fn(),
      onExit: vi.fn(),
    });

    await controller.handleInput(`${command}\ry`);

    expect(updateTaskStep).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: "/workspace",
      taskId: "terminal-dashboard",
      stepId: "build",
      expectedRevision: 4,
      ...expected,
    }));
  });

  it("loads the latest snapshot after a revision conflict and asks before retrying", async () => {
    const initial = snapshot({
      task: { ...snapshot().task, status: "in_progress", revision: 4 },
      steps: snapshot().steps.map((step) => {
        if (step.id !== "build") return step;
        const { blockedReason: _blockedReason, ...unblocked } = step;
        return { ...unblocked, status: "in_progress" as const };
      }),
    });
    const latest = snapshot({ task: { ...initial.task, revision: 5 }, steps: initial.steps });
    const completed = snapshot({
      task: { ...latest.task, revision: 6 },
      steps: latest.steps.map((step) => step.id === "build"
        ? { ...step, status: "completed" as const }
        : step),
    });
    const updateTaskStep = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: "revision_conflict" as const,
          message: "The task changed after it was read.",
          latestRevision: 5,
        },
      })
      .mockResolvedValueOnce(result(completed));
    const getTaskProgress = vi.fn(async () => result(latest));
    const controller = new TerminalController({
      input: new FakeTerminalInput(true),
      service: { getTaskProgress, updateTaskStep } as unknown as TaskProgressService,
      workspaceRoot: "/workspace",
      snapshot: initial,
      onRender: vi.fn(),
      onExit: vi.fn(),
    });

    await controller.handleInput(":done build\ry");

    expect(getTaskProgress).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().task.revision).toBe(5);
    expect(controller.getViewState()).toMatchObject({
      mode: "confirm",
      confirmation: expect.stringMatching(/changed from 4 to 5.*retry/iu),
    });

    await controller.handleInput("y");
    expect(updateTaskStep).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedRevision: 5 }));
    expect(controller.getSnapshot().task.revision).toBe(6);
  });

  it("rejects commands outside the allowlist without invoking task mutation", async () => {
    const updateTaskStep = vi.fn();
    const controller = new TerminalController({
      input: new FakeTerminalInput(true),
      service: {
        getTaskProgress: vi.fn(),
        updateTaskStep,
      } as unknown as TaskProgressService,
      workspaceRoot: "/workspace",
      snapshot: snapshot(),
      onRender: vi.fn(),
      onExit: vi.fn(),
    });

    await controller.handleInput(":shell rm -rf /\r");

    expect(updateTaskStep).not.toHaveBeenCalled();
    expect(controller.getViewState()).toMatchObject({
      mode: "normal",
      noticeTone: "error",
      notice: expect.stringMatching(/unknown command/iu),
    });
  });
});

describe("Terminal redraws are reserved for interactive sessions", () => {
  it("does not emit ANSI screen-control sequences for a non-interactive stream, even when color is requested", () => {
    const output = renderTaskProgressTerminal(snapshot(), {
      interactive: false,
      color: true,
    });

    expect(output).not.toMatch(/\u001B\[/u);
  });

  it("clears and homes the screen before an interactive redraw", () => {
    const output = renderTaskProgressTerminal(snapshot(), {
      interactive: true,
      color: false,
    });

    expect(output.startsWith("\u001B[2J\u001B[H")).toBe(true);
  });
});

describe("Terminal output treats task content as untrusted text", () => {
  it("removes ESC and C0 control characters from task titles and blocked reasons", () => {
    const unsafeTitle = "Deliver\u001B[2J\u0007 dashboard\u0000";
    const unsafeBlockedReason = "Wait\u001B[H\u0008 for approval\u0007";
    const current = snapshot({
      task: { ...snapshot().task, title: unsafeTitle },
      steps: snapshot().steps.map((step) => step.id === "build"
        ? { ...step, blockedReason: unsafeBlockedReason }
        : step),
    });

    const output = renderTaskProgressTerminal(current, {
      interactive: false,
      color: false,
    });

    expect(output).not.toContain("\u001B");
    expect(output).not.toContain("\u0000");
    expect(output).not.toContain("\u0007");
    expect(output).not.toContain("\u0008");
    expect(output).toContain("Deliver dashboard");
    expect(output).toContain("Wait for approval");
  });
});

describe("The one-shot CLI reads persisted task-progress state", () => {
  it("renders the selected task from a freshly opened service and honors the requested state directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "rv-workflow-terminal-"));
    temporaryDirectories.push(root);
    const workspaceRoot = join(root, "product-workspace");
    const stateDirectory = join(root, "state");
    await mkdir(workspaceRoot, { recursive: true });

    const writer = await createTaskProgressService({ stateDirectory });
    const created = await writer.createTask({
      workspaceRoot,
      title: "Read real task state",
      idempotencyKey: "terminal-once",
      steps: [{ id: "qa", title: "Verify terminal output", role: "qa", dependsOn: [] }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.message);

    const stdout = writableBuffer(false);
    let openedStateDirectory: string | undefined;
    const exitCode = await runProgressCli({
      argv: [
        "--once",
        "--workspace", workspaceRoot,
        "--task-id", created.task.id,
        "--state-dir", stateDirectory,
      ],
      stdout,
      stderr: writableBuffer(false),
      createService: async ({ stateDirectory: opened }) => {
        openedStateDirectory = opened;
        if (opened === undefined) {
          throw new Error("The CLI must pass the requested state directory to its service.");
        }
        return createTaskProgressService({ stateDirectory: opened });
      },
    });

    expect(exitCode).toBe(0);
    expect(openedStateDirectory).toBe(stateDirectory);
    expect(stdout.contents).toContain("Read real task state");
    expect(stdout.contents).toContain("Verify terminal output");
  });

  it("does not create a missing state directory while default once mode only reads it", async () => {
    const root = await mkdtemp(join(tmpdir(), "rv-workflow-terminal-"));
    temporaryDirectories.push(root);
    const workspaceRoot = join(root, "product-workspace");
    const missingStateDirectory = join(root, "missing-state");
    await mkdir(workspaceRoot, { recursive: true });

    const exitCode = await runProgressCli({
      argv: ["--once", "--workspace", workspaceRoot, "--state-dir", missingStateDirectory],
      stdout: writableBuffer(false),
      stderr: writableBuffer(false),
    });

    expect(exitCode).not.toBe(0);
    await expect(stat(missingStateDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("CLI option errors fail before task state is read", () => {
  it.each([
    ["an unknown option", ["--unknown"]],
    ["conflicting once and watch modes", ["--once", "--watch"]],
  ])("reports usage and a non-zero exit for %s", async (_scenario, argv) => {
    const stdout = writableBuffer(false);
    const stderr = writableBuffer(false);
    const createService = vi.fn(async () => {
      throw new Error("The CLI must reject invalid options before opening state.");
    });

    const exitCode = await runProgressCli({
      argv,
      stdout,
      stderr,
      createService,
    });

    expect(exitCode).not.toBe(0);
    expect(stderr.contents).toMatch(/usage:/iu);
    expect(createService).not.toHaveBeenCalled();
    expect(stdout.contents).toBe("");
  });

  it("rejects watch mode on a non-TTY stream instead of continuously appending frames", async () => {
    const stdout = writableBuffer(false);
    const stderr = writableBuffer(false);
    const createService = vi.fn(async () => {
      throw new Error("Watch mode must be rejected before opening state for a pipe.");
    });

    const exitCode = await runProgressCli({
      argv: ["--watch", "--workspace", "/workspace"],
      stdout,
      stderr,
      createService,
    });

    expect(exitCode).not.toBe(0);
    expect(stderr.contents).toMatch(/--watch.*TTY|TTY.*--watch/iu);
    expect(createService).not.toHaveBeenCalled();
    expect(stdout.contents).toBe("");
  });
});

describe("The interactive watch CLI restores terminal state", () => {
  it("restores raw mode and the cursor after q requests a normal exit", async () => {
    const input = new FakeTerminalInput(true);
    const stdout = writableBuffer(true);
    const service = {
      getTaskProgress: vi.fn(async () => result(snapshot())),
      updateTaskStep: vi.fn(),
    } as unknown as TaskProgressService;

    const running = runProgressCli({
      argv: ["--watch", "--workspace", "/workspace", "--interval", "60000"],
      stdin: input,
      stdout,
      stderr: writableBuffer(false),
      createService: async () => service,
    });
    for (let attempt = 0; attempt < 20 && input.rawModes.length === 0; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    input.emit("data", "q");

    await expect(running).resolves.toBe(0);
    expect(input.rawModes).toEqual([true, false]);
    expect(stdout.contents).toContain("\u001B[?25l");
    expect(stdout.contents).toContain("\u001B[?25h");
  });

  it("exits after an ensured panel remains on completed work for its idle timeout", async () => {
    vi.useFakeTimers();
    const input = new FakeTerminalInput(true);
    const stdout = writableBuffer(true);
    const completed = snapshot({
      task: { ...snapshot().task, status: "completed" },
    });

    const running = runProgressCli({
      argv: [
        "--watch",
        "--workspace", "/workspace",
        "--interval", "60000",
        "--idle-timeout", "25",
      ],
      stdin: input,
      stdout,
      stderr: writableBuffer(false),
      createService: async () => ({
        getTaskProgress: vi.fn(async () => result(completed)),
        updateTaskStep: vi.fn(),
      } as unknown as TaskProgressService),
    });

    for (let attempt = 0; attempt < 20 && input.rawModes.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(25);

    await expect(running).resolves.toBe(0);
    expect(input.rawModes).toEqual([true, false]);
    expect(stdout.contents).toContain("\u001B[?25h");
  });

  it("keeps watching when new active work appears before the idle timeout", async () => {
    vi.useFakeTimers();
    const input = new FakeTerminalInput(true);
    const stdout = writableBuffer(true);
    const completed = snapshot({ task: { ...snapshot().task, status: "completed", revision: 4 } });
    const active = snapshot({ task: { ...snapshot().task, status: "in_progress", revision: 5 } });
    let reads = 0;
    let settled = false;

    const running = runProgressCli({
      argv: [
        "--watch",
        "--workspace", "/workspace",
        "--interval", "100",
        "--idle-timeout", "250",
      ],
      stdin: input,
      stdout,
      stderr: writableBuffer(false),
      createService: async () => ({
        getTaskProgress: vi.fn(async () => reads++ === 0 ? result(completed) : result(active)),
        updateTaskStep: vi.fn(),
      } as unknown as TaskProgressService),
    });
    void running.then(() => { settled = true; });

    for (let attempt = 0; attempt < 20 && input.rawModes.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toBe(false);

    input.emit("data", "q");
    await expect(running).resolves.toBe(0);
  });

  it("restores raw mode and the cursor when rendering throws", async () => {
    const input = new FakeTerminalInput(true);
    let contents = "";
    const stdout = {
      isTTY: true,
      write(chunk: string | Uint8Array) {
        const text = String(chunk);
        contents += text;
        if (text.includes("\u001B[2J")) throw new Error("render failed");
        return true;
      },
    };

    const exitCode = await runProgressCli({
      argv: ["--watch", "--workspace", "/workspace", "--interval", "60000"],
      stdin: input,
      stdout,
      stderr: writableBuffer(false),
      createService: async () => ({
        getTaskProgress: vi.fn(async () => result(snapshot())),
        updateTaskStep: vi.fn(),
      } as unknown as TaskProgressService),
    });

    expect(exitCode).toBe(1);
    expect(input.rawModes).toEqual([true, false]);
    expect(contents).toContain("\u001B[?25h");
  });
});

describe("The watch loop only redraws meaningful task changes", () => {
  it("renders the initial snapshot, refreshes after a newer revision, and stops polling cleanly", async () => {
    vi.useFakeTimers();
    let current = snapshot({
      task: { ...snapshot().task, revision: 1, status: "in_progress" },
    });
    let reads = 0;
    const service = {
      getTaskProgress: async () => {
        reads += 1;
        return result(current);
      },
    } as Pick<TaskProgressService, "getTaskProgress"> as TaskProgressService;
    const renderedRevisions: number[] = [];

    const watcher = await watchTaskProgress({
      service,
      workspaceRoot: "/workspace",
      taskId: "terminal-dashboard",
      intervalMs: 25,
      onSnapshot: (next) => renderedRevisions.push(next.task.revision),
    });

    expect(renderedRevisions).toEqual([1]);
    await vi.advanceTimersByTimeAsync(25);
    expect(renderedRevisions).toEqual([1]);

    current = snapshot({
      task: { ...current.task, revision: 2, status: "blocked" },
    });
    await vi.advanceTimersByTimeAsync(25);
    expect(renderedRevisions).toEqual([1, 2]);

    watcher.stop();
    const readsBeforeStop = reads;
    await vi.advanceTimersByTimeAsync(100);
    expect(reads).toBe(readsBeforeStop);
    expect(renderedRevisions).toEqual([1, 2]);
  });

  it.each([
    ["a newer snapshot", () => result(snapshot({ task: { ...snapshot().task, revision: 2 } }))],
    ["a read failure", () => ({
      ok: false as const,
      error: { code: "storage_error" as const, message: "The task state is temporarily unavailable." },
    })],
  ])("does not notify after stop when an in-flight read resolves with %s", async (_outcome, resolveResult) => {
    vi.useFakeTimers();
    const initial = snapshot({ task: { ...snapshot().task, revision: 1 } });
    let resolveRead: ((value: TaskProgressResult) => void) | undefined;
    let reads = 0;
    const service = {
      getTaskProgress: async () => {
        reads += 1;
        if (reads === 1) return result(initial);
        return new Promise<TaskProgressResult>((resolve) => {
          resolveRead = resolve;
        });
      },
    } as Pick<TaskProgressService, "getTaskProgress"> as TaskProgressService;
    const renderedRevisions: number[] = [];
    const errors: string[] = [];

    const watcher = await watchTaskProgress({
      service,
      workspaceRoot: "/workspace",
      intervalMs: 25,
      onSnapshot: (next) => renderedRevisions.push(next.task.revision),
      onError: (message) => errors.push(message),
    });

    await vi.advanceTimersByTimeAsync(25);
    expect(resolveRead).toBeTypeOf("function");
    watcher.stop();
    resolveRead?.(resolveResult());
    await Promise.resolve();
    await Promise.resolve();

    expect(renderedRevisions).toEqual([1]);
    expect(errors).toEqual([]);
  });

  it("reports a repeating refresh error once, then permits it again after a successful refresh", async () => {
    vi.useFakeTimers();
    const initial = snapshot({ task: { ...snapshot().task, revision: 1 } });
    const recovered = snapshot({ task: { ...snapshot().task, revision: 2 } });
    const unavailable = {
      ok: false as const,
      error: { code: "storage_error" as const, message: "The task state is temporarily unavailable." },
    };
    const responses: TaskProgressResult[] = [
      result(initial),
      unavailable,
      unavailable,
      result(recovered),
      unavailable,
    ];
    const service = {
      getTaskProgress: async () => responses.shift() ?? unavailable,
    } as Pick<TaskProgressService, "getTaskProgress"> as TaskProgressService;
    const renderedRevisions: number[] = [];
    const errors: string[] = [];

    const watcher = await watchTaskProgress({
      service,
      workspaceRoot: "/workspace",
      intervalMs: 25,
      onSnapshot: (next) => renderedRevisions.push(next.task.revision),
      onError: (message) => errors.push(message),
    });

    await vi.advanceTimersByTimeAsync(25 * 4);
    watcher.stop();

    expect(renderedRevisions).toEqual([1, 2]);
    expect(errors).toEqual([
      "The task state is temporarily unavailable.",
      "The task state is temporarily unavailable.",
    ]);
  });
});
