#!/usr/bin/env node

// mcp/src/progress-cli.ts
import { fileURLToPath } from "node:url";
import { resolve as resolve3 } from "node:path";

// mcp/src/task-progress-service.ts
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, win32 } from "node:path";
var STEP_ROLES = [
  "planner",
  "test-writer",
  "backend",
  "frontend",
  "document",
  "qa"
];
var STEP_STATUSES = [
  "pending",
  "in_progress",
  "blocked",
  "completed",
  "skipped"
];
var MAX_EVENTS = 100;
var STALE_AFTER_MS = 24 * 60 * 60 * 1e3;
var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var EVENT_KINDS = /* @__PURE__ */ new Set([
  "task_created",
  "step_started",
  "step_resumed",
  "step_blocked",
  "step_completed",
  "step_skipped"
]);
var TRANSITIONS = {
  pending: /* @__PURE__ */ new Set(["in_progress", "blocked", "skipped"]),
  in_progress: /* @__PURE__ */ new Set(["blocked", "completed"]),
  blocked: /* @__PURE__ */ new Set(["in_progress", "skipped"]),
  completed: /* @__PURE__ */ new Set(),
  skipped: /* @__PURE__ */ new Set()
};
var InputError = class extends Error {
};
var StorageError = class extends Error {
};
function failure(code, message, latestRevision) {
  return {
    ok: false,
    error: latestRevision === void 0 ? { code, message } : { code, message, latestRevision }
  };
}
function defaultTaskProgressStateDirectory() {
  if (process.platform === "win32") {
    return resolve(
      process.env.LOCALAPPDATA ?? resolve(homedir(), "AppData", "Local"),
      "rv-workflow"
    );
  }
  if (process.platform === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "rv-workflow");
  }
  return resolve(
    process.env.XDG_STATE_HOME ?? resolve(homedir(), ".local", "state"),
    "rv-workflow"
  );
}
function cleanLabel(root) {
  const value = basename(root).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return value.slice(0, 120) || "workspace";
}
async function identifyWorkspace(workspaceRoot) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0 || workspaceRoot.length > 4096) {
    throw new InputError("workspaceRoot must be a non-empty path no longer than 4096 characters.");
  }
  const requestedRoot = resolve(workspaceRoot);
  let root;
  try {
    root = await realpath(requestedRoot);
    if (!(await stat(root)).isDirectory()) {
      throw new InputError("workspaceRoot must refer to an existing directory.");
    }
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("workspaceRoot must refer to an existing directory.");
  }
  return {
    root,
    key: createHash("sha256").update(root).digest("hex"),
    ...requestedRoot === root ? {} : { legacyKey: createHash("sha256").update(requestedRoot).digest("hex") },
    label: cleanLabel(root)
  };
}
function assertString(value, field, max) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new InputError(`${field} must be a non-empty string no longer than ${max} characters.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new InputError(`${field} contains unsupported control characters.`);
  }
}
function assertIdentifier(value, field) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new InputError(`${field} must contain only letters, numbers, period, underscore, or hyphen.`);
  }
}
function assertNoWorkspacePath(value, workspace, field) {
  if (value.includes(workspace.root)) {
    throw new InputError(`${field} must not contain an absolute workspace path.`);
  }
}
function normalizeWorkspacePath(value, workspace, field) {
  assertString(value, field, 512);
  const absolute = isAbsolute(value) ? resolve(value) : resolve(workspace.root, value);
  const normalized = relative(workspace.root, absolute);
  if (normalized === "" || normalized === ".." || normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(normalized)) {
    throw new InputError(`${field} must be a file path inside the workspace.`);
  }
  return normalized.replaceAll("\\", "/");
}
function validateCreateInput(input, workspace) {
  assertString(input.title, "title", 200);
  assertNoWorkspacePath(input.title, workspace, "title");
  assertString(input.idempotencyKey, "idempotencyKey", 200);
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 100) {
    throw new InputError("steps must contain between 1 and 100 dependency-ordered steps.");
  }
  const seen = /* @__PURE__ */ new Set();
  const steps = input.steps.map((step, index) => {
    if (!step || typeof step !== "object") throw new InputError(`steps[${index}] must be an object.`);
    assertIdentifier(step.id, `steps[${index}].id`);
    if (seen.has(step.id)) throw new InputError(`Duplicate step id: ${step.id}.`);
    assertString(step.title, `steps[${index}].title`, 200);
    assertNoWorkspacePath(step.title, workspace, `steps[${index}].title`);
    if (!STEP_ROLES.includes(step.role)) throw new InputError(`steps[${index}].role is not supported.`);
    if (!Array.isArray(step.dependsOn) || step.dependsOn.some((dependency) => typeof dependency !== "string")) {
      throw new InputError(`steps[${index}].dependsOn must be an array of step ids.`);
    }
    const dependencies = [...new Set(step.dependsOn)];
    if (dependencies.length !== step.dependsOn.length || dependencies.some((dependency) => !seen.has(dependency))) {
      throw new InputError(`steps[${index}].dependsOn must reference unique earlier steps.`);
    }
    if (step.owner !== void 0) {
      assertString(step.owner, `steps[${index}].owner`, 100);
      assertNoWorkspacePath(step.owner, workspace, `steps[${index}].owner`);
    }
    seen.add(step.id);
    return {
      id: step.id,
      title: step.title.trim(),
      role: step.role,
      status: "pending",
      dependsOn: dependencies,
      ...step.owner === void 0 ? {} : { owner: step.owner.trim() }
    };
  });
  return {
    title: input.title.trim(),
    idempotencyKey: input.idempotencyKey,
    steps,
    ...input.specPath === void 0 ? {} : { specPath: normalizeWorkspacePath(input.specPath, workspace, "specPath") }
  };
}
function validateUpdateInput(input, workspace) {
  assertIdentifier(input.taskId, "taskId");
  assertIdentifier(input.stepId, "stepId");
  if (!STEP_STATUSES.includes(input.status)) throw new InputError("status is not supported.");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new InputError("expectedRevision must be a positive integer.");
  }
  if (input.summary !== void 0) {
    assertString(input.summary, "summary", 1e3);
    assertNoWorkspacePath(input.summary, workspace, "summary");
  }
  if (input.status === "blocked") {
    assertString(input.blockedReason, "blockedReason", 1e3);
    assertNoWorkspacePath(input.blockedReason, workspace, "blockedReason");
  } else if (input.blockedReason !== void 0) {
    throw new InputError("blockedReason is only allowed when status is blocked.");
  }
  if (input.evidenceRefs !== void 0) {
    if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length > 20) {
      throw new InputError("evidenceRefs must contain no more than 20 entries.");
    }
    for (const [index, reference] of input.evidenceRefs.entries()) {
      assertString(reference, `evidenceRefs[${index}]`, 240);
      const normalized = reference.replaceAll("\\", "/");
      if (isAbsolute(reference) || win32.isAbsolute(reference) || reference.includes(workspace.root) || /(?:bearer\s+|password\s*=|token\s*=)/i.test(reference)) {
        throw new InputError(`evidenceRefs[${index}] must be a safe relative path or command label.`);
      }
      const normalizedRelative = relative(workspace.root, resolve(workspace.root, normalized));
      if (normalizedRelative === ".." || normalizedRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(normalizedRelative)) {
        throw new InputError(`evidenceRefs[${index}] must not escape the workspace.`);
      }
    }
  }
}
function isTaskProgressStep(value) {
  if (!value || typeof value !== "object") return false;
  const step = value;
  return typeof step.id === "string" && typeof step.title === "string" && typeof step.role === "string" && STEP_ROLES.includes(step.role) && typeof step.status === "string" && STEP_STATUSES.includes(step.status) && Array.isArray(step.dependsOn) && step.dependsOn.every((dependency) => typeof dependency === "string") && (step.owner === void 0 || typeof step.owner === "string") && (step.summary === void 0 || typeof step.summary === "string") && (step.blockedReason === void 0 || typeof step.blockedReason === "string") && (step.startedAt === void 0 || typeof step.startedAt === "string") && (step.completedAt === void 0 || typeof step.completedAt === "string");
}
function isTaskProgressEvent(value) {
  if (!value || typeof value !== "object") return false;
  const event = value;
  return typeof event.id === "string" && typeof event.kind === "string" && EVENT_KINDS.has(event.kind) && typeof event.at === "string" && typeof event.summary === "string" && (event.stepId === void 0 || typeof event.stepId === "string") && Array.isArray(event.evidenceRefs) && event.evidenceRefs.every((reference) => typeof reference === "string");
}
function parseStoredState(contents, workspace) {
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new StorageError("The task state file is damaged and was preserved for recovery.");
  }
  if (!value || typeof value !== "object") {
    throw new StorageError("The task state file has an invalid structure and was preserved for recovery.");
  }
  const state = value;
  const tasks = state.tasks;
  const idempotency = state.idempotency;
  if (state.schemaVersion !== 1 || state.workspaceKey !== workspace.key && state.workspaceKey !== workspace.legacyKey || typeof state.workspaceLabel !== "string" || !Array.isArray(tasks) || !idempotency || typeof idempotency !== "object" || Array.isArray(idempotency)) {
    throw new StorageError("The task state file has an invalid structure and was preserved for recovery.");
  }
  const validTasks = tasks.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const task = entry;
    return typeof task.id === "string" && typeof task.title === "string" && (task.specPath === void 0 || typeof task.specPath === "string") && Number.isSafeInteger(task.revision) && Number(task.revision) >= 1 && typeof task.createdAt === "string" && Number.isFinite(Date.parse(task.createdAt)) && typeof task.updatedAt === "string" && Number.isFinite(Date.parse(task.updatedAt)) && Array.isArray(task.steps) && task.steps.every(isTaskProgressStep) && Array.isArray(task.events) && task.events.every(isTaskProgressEvent);
  });
  const validIdempotency = Object.values(idempotency).every((taskId) => typeof taskId === "string");
  const taskIds = new Set(
    validTasks ? tasks.map((task) => task.id) : []
  );
  const indexesResolve = validIdempotency && Object.values(idempotency).every((taskId) => taskIds.has(taskId));
  if (!validTasks || !validIdempotency || taskIds.size !== tasks.length || !indexesResolve) {
    throw new StorageError("The task state file has an invalid structure and was preserved for recovery.");
  }
  const parsed = value;
  return parsed.workspaceKey === workspace.key ? parsed : { ...parsed, workspaceKey: workspace.key, workspaceLabel: workspace.label };
}
function emptyState(workspace) {
  return {
    schemaVersion: 1,
    workspaceKey: workspace.key,
    workspaceLabel: workspace.label,
    tasks: [],
    idempotency: {}
  };
}
async function readState(stateDirectory, workspace) {
  const statePath = resolve(stateDirectory, workspace.key, "state.json");
  try {
    return parseStoredState(await readFile(statePath, "utf8"), workspace);
  } catch (error) {
    if (error.code === "ENOENT" && workspace.legacyKey !== void 0) {
      const legacyStatePath = resolve(stateDirectory, workspace.legacyKey, "state.json");
      try {
        return parseStoredState(await readFile(legacyStatePath, "utf8"), workspace);
      } catch (legacyError) {
        if (legacyError.code === "ENOENT") return emptyState(workspace);
        if (legacyError instanceof StorageError) throw legacyError;
        throw new StorageError("The task state file could not be read. Check its permissions and try again.");
      }
    }
    if (error.code === "ENOENT") return emptyState(workspace);
    if (error instanceof StorageError) throw error;
    throw new StorageError("The task state file could not be read. Check its permissions and try again.");
  }
}
async function writeState(stateDirectory, workspace, state) {
  const directory = resolve(stateDirectory, workspace.key);
  const destination = resolve(directory, "state.json");
  const temporary = resolve(directory, `.state-${process.pid}-${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true, mode: 448 });
    const handle = await open(temporary, "wx", 384);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}
`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
    try {
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch {
    }
  } catch {
    await unlink(temporary).catch(() => void 0);
    throw new StorageError("The task state file could not be saved. Existing state was not intentionally replaced.");
  }
}
function copyStep(step) {
  return {
    id: step.id,
    title: step.title,
    role: step.role,
    status: step.status,
    dependsOn: [...step.dependsOn],
    ...step.owner === void 0 ? {} : { owner: step.owner },
    ...step.summary === void 0 ? {} : { summary: step.summary },
    ...step.blockedReason === void 0 ? {} : { blockedReason: step.blockedReason },
    ...step.startedAt === void 0 ? {} : { startedAt: step.startedAt },
    ...step.completedAt === void 0 ? {} : { completedAt: step.completedAt }
  };
}
function deriveSnapshot(workspace, task, now) {
  const steps = task.steps.map(copyStep);
  const actionable = steps.filter((step) => step.status !== "skipped");
  const completedSteps = actionable.filter((step) => step.status === "completed").length;
  const actionableSteps = actionable.length;
  const percent = actionableSteps === 0 ? null : Math.round(completedSteps / actionableSteps * 100);
  const terminalIds = new Set(
    steps.filter((step) => step.status === "completed" || step.status === "skipped").map((step) => step.id)
  );
  const nextRunnableStep = steps.find((step) => step.status === "in_progress") ?? steps.find(
    (step) => step.status === "pending" && step.dependsOn.every((dependency) => terminalIds.has(dependency))
  ) ?? null;
  let status;
  if (actionable.every((step) => step.status === "completed")) {
    status = "completed";
  } else if (nextRunnableStep === null && steps.some((step) => step.status === "blocked")) {
    status = "blocked";
  } else if (steps.some((step) => step.status !== "pending")) {
    status = "in_progress";
  } else {
    status = "pending";
  }
  const taskView = {
    id: task.id,
    title: task.title,
    status,
    revision: task.revision,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...task.specPath === void 0 ? {} : { specPath: task.specPath }
  };
  return {
    schemaVersion: 1,
    workspaceKey: workspace.key,
    workspaceLabel: workspace.label,
    task: taskView,
    progress: {
      completedSteps,
      actionableSteps,
      percent,
      label: actionableSteps === 0 ? "No actionable steps" : `${completedSteps} / ${actionableSteps} actionable steps`
    },
    steps,
    events: task.events.map((event) => ({
      ...event,
      evidenceRefs: [...event.evidenceRefs]
    })),
    nextRunnableStep: nextRunnableStep === null ? null : copyStep(nextRunnableStep),
    isStale: now.getTime() - Date.parse(task.updatedAt) > STALE_AFTER_MS
  };
}
function success(workspace, task, now) {
  const snapshot = deriveSnapshot(workspace, task, now);
  return { ok: true, task: snapshot.task, revision: task.revision, snapshot };
}
function eventForUpdate(step, previousStatus, input, at) {
  const kind = input.status === "blocked" ? "step_blocked" : input.status === "completed" ? "step_completed" : input.status === "skipped" ? "step_skipped" : previousStatus === "blocked" ? "step_resumed" : "step_started";
  const defaultSummary = input.status === "blocked" ? input.blockedReason : `${step.title} ${input.status.replace("_", " ")}.`;
  return {
    id: `event-${randomUUID()}`,
    stepId: step.id,
    kind,
    at,
    summary: input.summary?.trim() ?? defaultSummary,
    evidenceRefs: input.evidenceRefs?.map((reference) => reference.trim()) ?? []
  };
}
async function createTaskProgressService(options = {}) {
  const stateDirectory = resolve(options.stateDirectory ?? defaultTaskProgressStateDirectory());
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  if (options.initializeStateDirectory !== false) {
    await mkdir(stateDirectory, { recursive: true, mode: 448 });
  }
  let writerQueue = Promise.resolve();
  const enqueueWrite = (operation) => {
    const result = writerQueue.then(operation, operation);
    writerQueue = result.then(() => void 0, () => void 0);
    return result;
  };
  return {
    async createTask(input) {
      let workspace;
      try {
        workspace = await identifyWorkspace(input.workspaceRoot);
      } catch (error) {
        return failure("invalid_input", error instanceof Error ? error.message : "workspaceRoot is invalid.");
      }
      return enqueueWrite(async () => {
        try {
          const validated = validateCreateInput(input, workspace);
          const state = await readState(stateDirectory, workspace);
          const idempotencyDigest = createHash("sha256").update(validated.idempotencyKey).digest("hex");
          const existingId = state.idempotency[idempotencyDigest];
          if (existingId !== void 0) {
            const existing = state.tasks.find((task2) => task2.id === existingId);
            if (!existing) throw new StorageError("The task state idempotency index is inconsistent and was preserved.");
            return success(workspace, existing, now());
          }
          const at = now().toISOString();
          const task = {
            id: `task-${randomUUID()}`,
            title: validated.title,
            revision: 1,
            createdAt: at,
            updatedAt: at,
            steps: validated.steps,
            events: [{
              id: `event-${randomUUID()}`,
              kind: "task_created",
              at,
              summary: `Created task: ${validated.title}`,
              evidenceRefs: []
            }],
            ...validated.specPath === void 0 ? {} : { specPath: validated.specPath }
          };
          state.tasks.push(task);
          state.idempotency[idempotencyDigest] = task.id;
          await writeState(stateDirectory, workspace, state);
          return success(workspace, task, now());
        } catch (error) {
          if (error instanceof InputError) return failure("invalid_input", error.message);
          return failure(
            "storage_error",
            error instanceof StorageError ? error.message : "Task state could not be created."
          );
        }
      });
    },
    async updateTaskStep(input) {
      let workspace;
      try {
        workspace = await identifyWorkspace(input.workspaceRoot);
        validateUpdateInput(input, workspace);
      } catch (error) {
        return failure("invalid_input", error instanceof Error ? error.message : "The update is invalid.");
      }
      return enqueueWrite(async () => {
        try {
          const state = await readState(stateDirectory, workspace);
          const task = state.tasks.find((candidate) => candidate.id === input.taskId);
          if (!task) return failure("not_found", "The task was not found in this workspace.");
          if (task.revision !== input.expectedRevision) {
            return failure(
              "revision_conflict",
              "The task changed after it was read. Read the latest snapshot before retrying.",
              task.revision
            );
          }
          const step = task.steps.find((candidate) => candidate.id === input.stepId);
          if (!step) return failure("not_found", "The step was not found in this task.");
          if (!TRANSITIONS[step.status].has(input.status)) {
            return failure(
              "invalid_transition",
              `A step cannot transition from ${step.status} to ${input.status}.`
            );
          }
          const at = now().toISOString();
          const previousStatus = step.status;
          step.status = input.status;
          if (input.summary !== void 0) step.summary = input.summary.trim();
          if (input.status === "blocked") step.blockedReason = input.blockedReason.trim();
          else delete step.blockedReason;
          if (input.status === "in_progress" && step.startedAt === void 0) step.startedAt = at;
          if (input.status === "completed" || input.status === "skipped") step.completedAt = at;
          task.revision += 1;
          task.updatedAt = at;
          task.events.push(eventForUpdate(step, previousStatus, input, at));
          if (task.events.length > MAX_EVENTS) task.events.splice(0, task.events.length - MAX_EVENTS);
          await writeState(stateDirectory, workspace, state);
          return success(workspace, task, now());
        } catch (error) {
          return failure(
            "storage_error",
            error instanceof StorageError ? error.message : "Task state could not be updated."
          );
        }
      });
    },
    async getTaskProgress(input) {
      let workspace;
      try {
        workspace = await identifyWorkspace(input.workspaceRoot);
        if (input.taskId !== void 0) assertIdentifier(input.taskId, "taskId");
      } catch (error) {
        return failure("invalid_input", error instanceof Error ? error.message : "The query is invalid.");
      }
      await writerQueue;
      try {
        const state = await readState(stateDirectory, workspace);
        let task = input.taskId === void 0 ? [...state.tasks].reverse().find((candidate) => deriveSnapshot(workspace, candidate, now()).task.status !== "completed") ?? state.tasks.at(-1) : state.tasks.find((candidate) => candidate.id === input.taskId);
        if (!task) return failure("not_found", "No task progress was found in this workspace.");
        return success(workspace, task, now());
      } catch (error) {
        return failure(
          "storage_error",
          error instanceof StorageError ? error.message : "Task state could not be read."
        );
      }
    }
  };
}

// mcp/src/task-progress-terminal-model.ts
function defaultTerminalViewState(snapshot) {
  return {
    mode: "normal",
    selectedStepId: snapshot.steps[0]?.id,
    expandedStepIds: [],
    searchQuery: "",
    statusFilter: "all",
    inputBuffer: "",
    helpVisible: false,
    confirmation: void 0,
    notice: void 0,
    noticeTone: "info"
  };
}
function visibleTerminalSteps(snapshot, view) {
  const query = view.searchQuery.trim().toLocaleLowerCase();
  return snapshot.steps.filter((step) => {
    if (view.statusFilter !== "all" && step.status !== view.statusFilter) return false;
    if (query === "") return true;
    return [
      step.id,
      step.title,
      step.role,
      step.status,
      step.owner,
      step.summary,
      step.blockedReason
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

// mcp/src/task-progress-terminal.ts
var statusPresentation = {
  pending: { icon: "\u25CB", color: 90 },
  in_progress: { icon: "\u25D0", color: 36 },
  blocked: { icon: "!", color: 31 },
  completed: { icon: "\u2713", color: 32 },
  skipped: { icon: "\u2212", color: 90 }
};
var color = {
  red: 31,
  green: 32,
  yellow: 33,
  magenta: 35,
  cyan: 36,
  brightWhite: 97
};
var style = {
  bold: 1,
  dim: 2
};
function safeText(value) {
  return value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/gu, "").replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
}
function safeInput(value) {
  return value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/gu, "").replace(/[\u0000-\u001f\u007f-\u009f]/gu, "");
}
function paint(value, codes, enabled) {
  const sequence = Array.isArray(codes) ? codes.join(";") : codes;
  return enabled ? `\x1B[${sequence}m${value}\x1B[0m` : value;
}
function progressBar(percent) {
  if (percent === null) return "[----------]";
  const completed = Math.round(Math.max(0, Math.min(100, percent)) / 10);
  return `[${"#".repeat(completed)}${"-".repeat(10 - completed)}]`;
}
function renderTaskProgressTerminal(snapshot, options) {
  const ansi = options.interactive && options.color;
  const taskStatus = statusPresentation[snapshot.task.status];
  const progress = snapshot.progress.percent === null ? snapshot.progress.label : `${snapshot.progress.percent}% \xB7 ${snapshot.progress.label}`;
  const lines = [
    `${paint("RV Workflow", [style.bold, color.cyan], ansi)} ${paint(`\xB7 ${safeText(snapshot.workspaceLabel)}`, style.dim, ansi)}`,
    `  ${paint(safeText(snapshot.task.title), [style.bold, color.brightWhite], ansi)}`,
    `  ${paint("Status:", style.dim, ansi)} ${paint(snapshot.task.status, taskStatus.color, ansi)} ${paint(`\xB7 Revision ${snapshot.task.revision}`, style.dim, ansi)}`,
    `  ${paint("Progress:", style.dim, ansi)} ${paint(progressBar(snapshot.progress.percent), color.cyan, ansi)} ${safeText(progress)}`,
    "",
    paint("Steps", [style.bold, color.cyan], ansi)
  ];
  const steps = options.view === void 0 ? snapshot.steps : visibleTerminalSteps(snapshot, options.view);
  for (const step of steps) {
    const presentation = statusPresentation[step.status];
    const icon = paint(presentation.icon, presentation.color, ansi);
    const selected = options.view?.selectedStepId === step.id;
    const marker = options.view === void 0 ? "  " : selected ? `${paint("\u203A", color.cyan, ansi)} ` : "  ";
    lines.push(
      `${marker}${icon} ${paint(safeText(step.role), [style.bold, color.magenta], ansi)} \xB7 ${paint(safeText(step.title), style.bold, ansi)} ${paint(`[${safeText(step.status)}]`, presentation.color, ansi)}`
    );
    const details = [
      ...step.owner ? [{ label: "Owner", value: safeText(step.owner), valueColor: color.cyan }] : [],
      ...step.summary ? [{ label: "Summary", value: safeText(step.summary) }] : [],
      ...step.blockedReason ? [{ label: "Blocked", value: safeText(step.blockedReason), valueColor: color.red }] : []
    ];
    const showDetails = options.view === void 0 || options.view.expandedStepIds.includes(step.id);
    if (showDetails) details.forEach((detail, index) => {
      const branch = index === details.length - 1 ? "\u2514\u2500" : "\u251C\u2500";
      const value = detail.valueColor === void 0 ? detail.value : paint(detail.value, detail.valueColor, ansi);
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
      `  ${paint("\u2192", color.cyan, ansi)} ${paint(safeText(snapshot.nextRunnableStep.role), [style.bold, color.magenta], ansi)} \xB7 ${paint(safeText(snapshot.nextRunnableStep.title), style.bold, ansi)}`
    );
  }
  if (snapshot.isStale) {
    lines.push("", paint("Warning: progress may be stale.", color.yellow, ansi));
  }
  lines.push("", paint(`Updated: ${safeText(snapshot.task.updatedAt)}`, style.dim, ansi));
  if (options.view !== void 0) {
    const search = options.view.searchQuery === "" ? "none" : safeText(options.view.searchQuery);
    lines.push(
      "",
      paint("\u2500".repeat(48), style.dim, ansi),
      paint(`Filter: ${options.view.statusFilter} \xB7 Search: ${search}`, style.dim, ansi)
    );
    if (options.view.helpVisible) {
      lines.push(
        paint("j/k move \xB7 Enter details \xB7 / search \xB7 f status filter \xB7 r refresh", color.cyan, ansi),
        paint("? help \xB7 q quit \xB7 : command", color.cyan, ansi),
        paint(':start STEP \xB7 :done STEP "SUMMARY" \xB7 :block STEP --reason "REASON" \xB7 :skip STEP', color.cyan, ansi),
        paint(":filter STATUS \xB7 :refresh \xB7 :help \xB7 :quit", color.cyan, ansi)
      );
    }
    if (options.view.notice !== void 0) {
      const noticeColor = options.view.noticeTone === "error" ? color.red : options.view.noticeTone === "success" ? color.green : color.yellow;
      lines.push(paint(safeText(options.view.notice), noticeColor, ansi));
    }
    if (options.view.mode === "search") {
      lines.push(`/ ${safeInput(options.view.inputBuffer)}_`);
    } else if (options.view.mode === "command") {
      lines.push(`: ${safeInput(options.view.inputBuffer)}_`);
    } else if (options.view.mode === "confirm") {
      lines.push(paint(safeText(options.view.confirmation ?? "Confirm command? [y/N]"), color.yellow, ansi));
    } else if (!options.view.helpVisible) {
      lines.push(paint("j/k move \xB7 Enter details \xB7 / search \xB7 f filter \xB7 r refresh \xB7 ? help \xB7 q quit \xB7 : command", style.dim, ansi));
    }
  }
  const frame = `${lines.join("\n")}
`;
  return options.interactive ? `\x1B[2J\x1B[H${frame}` : frame;
}
function readErrorMessage(result) {
  return result.ok ? "Task progress could not be read." : result.error.message;
}
async function watchTaskProgress(options) {
  const intervalMs = options.intervalMs ?? 1e3;
  let stopped = false;
  let reading = false;
  let lastTaskId;
  let lastRevision = 0;
  let lastError;
  const reportError = (message) => {
    if (message === lastError) return;
    lastError = message;
    options.onError?.(message);
  };
  const refresh = async (initial) => {
    if (stopped || reading) return;
    reading = true;
    try {
      const result = await options.service.getTaskProgress({
        workspaceRoot: options.workspaceRoot,
        ...options.taskId === void 0 ? {} : { taskId: options.taskId }
      });
      if (stopped) return;
      if (!result.ok) {
        const message = readErrorMessage(result);
        if (initial) throw new Error(message);
        reportError(message);
        return;
      }
      lastError = void 0;
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
    void refresh(false).catch((error) => {
      if (stopped) return;
      reportError(error instanceof Error ? error.message : "Task progress could not be refreshed.");
    });
  }, intervalMs);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

// mcp/src/task-progress-terminal-controller.ts
var STATUS_FILTERS = ["all", ...STEP_STATUSES];
var MAX_INPUT_LENGTH = 2e3;
function copyView(view) {
  return { ...view, expandedStepIds: [...view.expandedStepIds] };
}
function tokenizeCommand(command) {
  const tokens = [];
  let token = "";
  let quote;
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
    } else if (quote !== void 0) {
      if (character === quote) quote = void 0;
      else token += character;
      started = true;
    } else if (character === "'" || character === '"') {
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
  if (quote !== void 0 || escaping) return null;
  if (started) tokens.push(token);
  return tokens;
}
function commandLabel(name, stepId) {
  return `:${name} ${stepId}`;
}
var TerminalController = class {
  constructor(options) {
    this.options = options;
    this.snapshot = options.snapshot;
    this.view = defaultTerminalViewState(options.snapshot);
  }
  options;
  snapshot;
  view;
  pendingMutation;
  started = false;
  stopped = false;
  exitRequested = false;
  mutating = false;
  inputQueue = Promise.resolve();
  onData = (chunk) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.inputQueue = this.inputQueue.then(() => this.handleInput(text)).catch((error) => {
      try {
        this.setNotice(error instanceof Error ? error.message : "Terminal input failed.", "error");
      } catch {
      } finally {
        this.requestExit();
      }
    });
  };
  onInputError = (error) => {
    try {
      this.setNotice(`Terminal input failed: ${error.message}`, "error");
    } finally {
      this.requestExit();
    }
  };
  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    if (this.options.input.isTTY) this.options.input.setRawMode?.(true);
    this.options.input.setEncoding?.("utf8");
    this.options.input.on("data", this.onData);
    this.options.input.on("error", this.onInputError);
    this.options.input.resume?.();
    this.emit();
  }
  stop() {
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
  async whenIdle() {
    await this.inputQueue;
  }
  getViewState() {
    return copyView(this.view);
  }
  getSnapshot() {
    return this.snapshot;
  }
  updateSnapshot(snapshot) {
    const taskChanged = snapshot.task.id !== this.snapshot.task.id;
    const previousRevision = this.snapshot.task.revision;
    this.snapshot = snapshot;
    if (taskChanged) {
      this.pendingMutation = void 0;
      this.view = defaultTerminalViewState(snapshot);
      this.setNotice("Now following the latest active task.", "info", false);
    } else if (snapshot.task.revision !== previousRevision && this.view.mode === "confirm" && this.pendingMutation !== void 0) {
      this.view.confirmation = `Revision changed from ${previousRevision} to ${snapshot.task.revision}. Retry ${this.pendingMutation.label}? [y/N]`;
      this.setNotice("Latest snapshot loaded; review it before retrying.", "error", false);
      this.ensureSelection();
    } else {
      this.ensureSelection();
    }
    this.emit();
  }
  reportRefreshError(message) {
    this.setNotice(`Refresh failed: ${message}`, "error");
  }
  async handleInput(chunk) {
    if (this.stopped || this.mutating) return;
    const normalized = chunk.replace(/\r\n/gu, "\r").replace(/\u001B\[A/gu, "k").replace(/\u001B\[B/gu, "j");
    for (const character of normalized) {
      if (this.stopped || this.exitRequested) return;
      if (character === "") {
        this.requestExit();
        return;
      }
      if (this.view.mode === "normal") await this.handleNormalInput(character);
      else if (this.view.mode === "confirm") await this.handleConfirmInput(character);
      else this.handleEditingInput(character);
    }
  }
  async handleNormalInput(character) {
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
  async handleConfirmInput(character) {
    if (character === "y" || character === "Y" || character === "\r" || character === "\n") {
      await this.applyPendingMutation();
    } else if (character === "n" || character === "N" || character === "\x1B") {
      this.pendingMutation = void 0;
      this.returnToNormal("Command cancelled.", "info");
    }
  }
  handleEditingInput(character) {
    if (character === "\x1B") {
      this.returnToNormal(void 0, "info");
      return;
    }
    if (character === "\x7F" || character === "\b") {
      this.view.inputBuffer = Array.from(this.view.inputBuffer).slice(0, -1).join("");
      this.emit();
      return;
    }
    if (character === "\r" || character === "\n") {
      if (this.view.mode === "search") {
        this.view.searchQuery = this.view.inputBuffer;
        this.returnToNormal(void 0, "info");
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
  enterEditingMode(mode) {
    this.view.mode = mode;
    this.view.inputBuffer = mode === "search" ? this.view.searchQuery : "";
    this.view.confirmation = void 0;
    this.view.notice = void 0;
    this.emit();
  }
  returnToNormal(notice, tone) {
    this.view.mode = "normal";
    this.view.inputBuffer = "";
    this.view.confirmation = void 0;
    this.setNotice(notice, tone, false);
    this.emit();
  }
  moveSelection(offset) {
    const visible = visibleTerminalSteps(this.snapshot, this.view);
    if (visible.length === 0) return;
    const currentIndex = visible.findIndex((step) => step.id === this.view.selectedStepId);
    const base = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = Math.max(0, Math.min(visible.length - 1, base + offset));
    this.view.selectedStepId = visible[nextIndex]?.id;
    this.emit();
  }
  toggleSelectedDetails() {
    const stepId = this.view.selectedStepId;
    if (stepId === void 0) return;
    const expanded = new Set(this.view.expandedStepIds);
    if (expanded.has(stepId)) expanded.delete(stepId);
    else expanded.add(stepId);
    this.view.expandedStepIds = [...expanded];
    this.emit();
  }
  cycleStatusFilter() {
    const current = STATUS_FILTERS.indexOf(this.view.statusFilter);
    this.view.statusFilter = STATUS_FILTERS[(current + 1) % STATUS_FILTERS.length] ?? "all";
    this.ensureSelection();
    this.setNotice(`Status filter: ${this.view.statusFilter}`, "info", false);
    this.emit();
  }
  ensureSelection() {
    const visible = visibleTerminalSteps(this.snapshot, this.view);
    if (!visible.some((step) => step.id === this.view.selectedStepId)) {
      this.view.selectedStepId = visible[0]?.id;
    }
  }
  async refresh() {
    const result = await this.options.service.getTaskProgress({
      workspaceRoot: this.options.workspaceRoot,
      ...this.options.taskId === void 0 ? {} : { taskId: this.options.taskId }
    });
    if (!result.ok) {
      this.reportRefreshError(result.error.message);
      return;
    }
    this.updateSnapshot(result.snapshot);
    this.setNotice(`Refreshed revision ${result.revision}.`, "success");
  }
  executeCommand(command) {
    const tokens = tokenizeCommand(command);
    if (tokens === null) {
      this.returnToNormal("Command contains an unfinished quote or escape.", "error");
      return;
    }
    const [name, ...args] = tokens;
    if (name === void 0) {
      this.returnToNormal(void 0, "info");
      return;
    }
    if (name === "filter") {
      this.executeFilterCommand(args);
      return;
    }
    if (name === "refresh") {
      this.returnToNormal(void 0, "info");
      void this.refresh().catch((error) => {
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
      this.returnToNormal(void 0, "info");
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
      this.view.notice = void 0;
      this.emit();
      return;
    }
    this.returnToNormal(`Unknown command: ${name}. Press ? for allowed commands.`, "error");
  }
  executeFilterCommand(args) {
    const [filter, ...extra] = args;
    if (extra.length > 0 || !STATUS_FILTERS.includes(filter)) {
      this.returnToNormal("Usage: :filter all|pending|in_progress|blocked|completed|skipped", "error");
      return;
    }
    this.view.statusFilter = filter;
    this.ensureSelection();
    this.returnToNormal(`Status filter: ${filter}`, "success");
  }
  parseMutation(name, args) {
    const [stepId, ...rest] = args;
    if (stepId === void 0 || !this.snapshot.steps.some((step) => step.id === stepId)) {
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
          ...summary === "" ? {} : { summary }
        }
      };
    }
    if (rest[0] !== "--reason" || rest.length < 2) {
      return "Usage: :block <step-id> --reason <text>";
    }
    const blockedReason = rest.slice(1).join(" ").trim();
    if (blockedReason === "") return "Blocking requires a non-empty reason.";
    return { label, input: { stepId, status: "blocked", blockedReason } };
  }
  async applyPendingMutation() {
    const pending = this.pendingMutation;
    if (pending === void 0) {
      this.returnToNormal("No command is awaiting confirmation.", "error");
      return;
    }
    this.mutating = true;
    this.view.notice = `Applying ${pending.label}\u2026`;
    this.view.noticeTone = "info";
    this.emit();
    const expectedRevision = this.snapshot.task.revision;
    try {
      const result = await this.options.service.updateTaskStep({
        workspaceRoot: this.options.workspaceRoot,
        taskId: this.snapshot.task.id,
        expectedRevision,
        ...pending.input
      });
      if (result.ok) {
        this.snapshot = result.snapshot;
        this.pendingMutation = void 0;
        this.ensureSelection();
        this.returnToNormal(`${pending.label} completed at revision ${result.revision}.`, "success");
        return;
      }
      if (result.error.code === "revision_conflict") {
        await this.prepareConflictRetry(pending, expectedRevision);
        return;
      }
      this.pendingMutation = void 0;
      this.returnToNormal(result.error.message, "error");
    } finally {
      this.mutating = false;
    }
  }
  async prepareConflictRetry(pending, staleRevision) {
    const latest = await this.options.service.getTaskProgress({
      workspaceRoot: this.options.workspaceRoot,
      taskId: this.snapshot.task.id
    });
    if (!latest.ok) {
      this.pendingMutation = void 0;
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
  setNotice(notice, tone, emit = true) {
    this.view.notice = notice;
    this.view.noticeTone = tone;
    if (emit) this.emit();
  }
  emit() {
    if (!this.stopped) this.options.onRender(this.snapshot, copyView(this.view));
  }
  requestExit() {
    if (this.exitRequested) return;
    this.exitRequested = true;
    this.options.onExit();
  }
};

// mcp/src/progress-panel-launcher.ts
import { spawn } from "node:child_process";
var terminalJxa = String.raw`function run(argv) {
  function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
  }
  const terminal = Application("Terminal");
  terminal.activate();
  terminal.doScript(argv.map(shellQuote).join(" "));
}`;
var itermAppleScript = `on run argv
  set watcherCommand to item 1 of argv
  tell application "iTerm2"
    activate
    tell current session of current window
      split vertically with same profile command watcherCommand
    end tell
  end tell
end run`;
function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
function watcherArguments(options) {
  return [
    options.nodePath,
    options.cliPath,
    "--watch",
    "--workspace",
    options.workspaceRoot,
    ...options.taskId === void 0 ? [] : ["--task-id", options.taskId],
    ...options.stateDirectory === void 0 ? [] : ["--state-dir", options.stateDirectory],
    "--interval",
    String(options.intervalMs),
    options.color ? "--color" : "--no-color",
    ...options.idleTimeoutMs === void 0 ? [] : ["--idle-timeout", String(options.idleTimeoutMs)],
    ...options.instanceFile === void 0 ? [] : ["--instance-file", options.instanceFile],
    ...options.instanceToken === void 0 ? [] : ["--instance-token", options.instanceToken]
  ];
}
function watcherShellCommand(options) {
  return watcherArguments(options).map(shellQuote).join(" ");
}
function defaultRunCommand(file, args) {
  return new Promise((resolve4, reject) => {
    const child = spawn(file, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => resolve4({ exitCode: code ?? 1 }));
  });
}
function detectProgressPanelLauncher(options = {}) {
  if (options.launcher !== void 0 && options.launcher !== "auto") return options.launcher;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (env.TMUX) return "tmux";
  if (env.TERM_PROGRAM === "Orca") return "orca";
  if (platform === "darwin" && env.TERM_PROGRAM === "iTerm.app") return "iterm2";
  if (platform === "darwin") return "terminal";
  return "unsupported";
}
function resolveOrcaExecutable(env) {
  if (env.ORCA_CLI_COMMAND) return env.ORCA_CLI_COMMAND;
  if (env.ORCA_DEV_REPO_ROOT) return "orca-dev";
  return "orca";
}
async function launchProgressPanel(options) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const launcher = detectProgressPanelLauncher({
    platform,
    env,
    ...options.launcher === void 0 ? {} : { launcher: options.launcher }
  });
  if (launcher === "unsupported" || (launcher === "iterm2" || launcher === "terminal") && platform !== "darwin") {
    throw new Error("The task progress panel requires tmux, an Orca terminal, or macOS.");
  }
  const shellCommand = watcherShellCommand(options);
  let file;
  let args;
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
      "--json"
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

// mcp/src/progress-panel-instance.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { mkdir as mkdir2, readFile as readFile2, rename as rename2, unlink as unlink2, writeFile } from "node:fs/promises";
import { join, resolve as resolve2 } from "node:path";
var INSTANCE_VERSION = 1;
var LAUNCH_RESERVATION_TTL_MS = 3e4;
function instanceKey(workspaceRoot) {
  return createHash2("sha256").update(resolve2(workspaceRoot)).digest("hex");
}
function isNodeError(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}
function isRecord(value) {
  if (!value || typeof value !== "object") return false;
  const record = value;
  if (record.version !== INSTANCE_VERSION || record.state !== "launching" && record.state !== "running" || typeof record.token !== "string" || typeof record.createdAt !== "number") return false;
  if (record.state === "launching") return true;
  const pid = record.pid;
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0;
}
async function readRecord(filePath) {
  try {
    const value = JSON.parse(await readFile2(filePath, "utf8"));
    return isRecord(value) ? value : void 0;
  } catch (error) {
    if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) return void 0;
    throw error;
  }
}
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error, "EPERM");
  }
}
function recordIsActive(record, now) {
  if (record.state === "running") return processIsAlive(record.pid);
  return now - record.createdAt < LAUNCH_RESERVATION_TTL_MS;
}
async function removeIfOwned(filePath, token) {
  const record = await readRecord(filePath);
  if (record?.token !== token) return;
  try {
    await unlink2(filePath);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}
async function replaceRecord(filePath, record) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID2()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(record)}
`, { flag: "wx", mode: 384 });
  try {
    await rename2(temporaryPath, filePath);
  } catch (error) {
    await unlink2(temporaryPath).catch(() => void 0);
    throw error;
  }
}
async function reserveProgressPanel(options) {
  const stateDirectory = resolve2(options.stateDirectory ?? defaultTaskProgressStateDirectory());
  const instanceDirectory = options.instanceDirectory ?? join(stateDirectory, "panels");
  await mkdir2(instanceDirectory, { recursive: true, mode: 448 });
  const filePath = join(instanceDirectory, `${instanceKey(options.workspaceRoot)}.json`);
  const now = options.now ?? Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await readRecord(filePath);
    if (existing && recordIsActive(existing, now)) return { state: "already_running" };
    if (existing) await removeIfOwned(filePath, existing.token);
    else await unlink2(filePath).catch((error) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });
    const token = randomUUID2();
    const record = {
      version: INSTANCE_VERSION,
      state: "launching",
      token,
      createdAt: now
    };
    try {
      await writeFile(filePath, `${JSON.stringify(record)}
`, { flag: "wx", mode: 384 });
      return { state: "reserved", reservation: { filePath, token } };
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
  }
  return { state: "already_running" };
}
async function releaseProgressPanelReservation(reservation) {
  await removeIfOwned(reservation.filePath, reservation.token);
}
async function claimProgressPanel(reservation) {
  const record = await readRecord(reservation.filePath);
  if (record?.state !== "launching" || record.token !== reservation.token) return void 0;
  const running = {
    ...record,
    state: "running",
    pid: process.pid
  };
  await replaceRecord(reservation.filePath, running);
  return {
    async release() {
      await removeIfOwned(reservation.filePath, reservation.token);
    }
  };
}

// mcp/src/progress-cli.ts
var usage = `Usage: rv-workflow-progress --workspace <path> [--once | --watch | --panel | --ensure-panel]

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
var OptionError = class extends Error {
};
var ENSURED_PANEL_IDLE_TIMEOUT_MS = 3e4;
function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === void 0 || value.startsWith("--")) throw new OptionError(`${option} requires a value.`);
  return value;
}
function parseOptions(argv) {
  let once = false;
  let watch = false;
  let panel = false;
  let ensurePanel = false;
  let workspaceRoot;
  let taskId;
  let stateDirectory;
  let intervalMs = 1e3;
  let idleTimeoutMs;
  let color2 = "auto";
  let help = false;
  let launcher;
  let instanceFile;
  let instanceToken;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--once") once = true;
    else if (argument === "--watch") watch = true;
    else if (argument === "--panel") panel = true;
    else if (argument === "--ensure-panel") ensurePanel = true;
    else if (argument === "--color") {
      if (color2 === "never") throw new OptionError("--color and --no-color cannot be used together.");
      color2 = "always";
    } else if (argument === "--no-color") {
      if (color2 === "always") throw new OptionError("--color and --no-color cannot be used together.");
      color2 = "never";
    } else if (argument === "--help" || argument === "-h") help = true;
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
      launcher = value;
    } else if (argument === "--interval") {
      const value = takeValue(argv, index++, argument);
      intervalMs = Number(value);
      if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 6e4) {
        throw new OptionError("--interval must be an integer from 100 to 60000 milliseconds.");
      }
    } else if (argument === "--idle-timeout") {
      const value = takeValue(argv, index++, argument);
      idleTimeoutMs = Number(value);
      if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 10 || idleTimeoutMs > 6e5) {
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
  if (launcher !== void 0 && !panel && !ensurePanel) {
    throw new OptionError("--panel-launcher requires --panel or --ensure-panel.");
  }
  if (ensurePanel && taskId !== void 0) {
    throw new OptionError("--ensure-panel follows the latest active workspace task and cannot be used with --task-id.");
  }
  if (instanceFile === void 0 !== (instanceToken === void 0)) {
    throw new OptionError("--instance-file and --instance-token must be used together.");
  }
  if ((instanceFile !== void 0 || instanceToken !== void 0) && !watch) {
    throw new OptionError("--instance-file and --instance-token are internal --watch options.");
  }
  if (idleTimeoutMs !== void 0 && !watch && !panel && !ensurePanel) {
    throw new OptionError("--idle-timeout requires --watch, --panel, or --ensure-panel.");
  }
  if (!help && !workspaceRoot) throw new OptionError("--workspace is required.");
  return {
    mode: ensurePanel ? "ensure-panel" : panel ? "panel" : watch ? "watch" : "once",
    workspaceRoot: workspaceRoot ?? ".",
    intervalMs,
    ...idleTimeoutMs === void 0 && !ensurePanel ? {} : { idleTimeoutMs: idleTimeoutMs ?? ENSURED_PANEL_IDLE_TIMEOUT_MS },
    color: color2,
    help,
    ...taskId === void 0 ? {} : { taskId },
    ...stateDirectory === void 0 ? {} : { stateDirectory },
    ...launcher === void 0 ? {} : { launcher },
    ...instanceFile === void 0 ? {} : { instanceFile },
    ...instanceToken === void 0 ? {} : { instanceToken }
  };
}
function errorMessage(error) {
  return error instanceof Error ? error.message : "Task progress could not be displayed.";
}
function colorEnabled(preference) {
  return preference === "always" || preference === "auto" && process.env.NO_COLOR === void 0;
}
async function runProgressCli(options) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const stdin = options.stdin ?? process.stdin;
  let parsed;
  try {
    parsed = parseOptions(options.argv);
  } catch (error) {
    stderr.write(`${errorMessage(error)}

${usage}`);
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
    let reservation;
    try {
      if (parsed.mode === "ensure-panel") {
        const reservationResult = await reserveProgressPanel({
          workspaceRoot: parsed.workspaceRoot,
          ...parsed.stateDirectory === void 0 ? {} : { stateDirectory: parsed.stateDirectory },
          ...options.instanceDirectory === void 0 ? {} : { instanceDirectory: options.instanceDirectory }
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
        ...parsed.idleTimeoutMs === void 0 ? {} : { idleTimeoutMs: parsed.idleTimeoutMs },
        ...parsed.taskId === void 0 ? {} : { taskId: parsed.taskId },
        ...parsed.stateDirectory === void 0 ? {} : { stateDirectory: parsed.stateDirectory },
        ...parsed.launcher === void 0 ? {} : { launcher: parsed.launcher },
        ...reservation === void 0 ? {} : {
          instanceFile: reservation.filePath,
          instanceToken: reservation.token
        }
      });
      return 0;
    } catch (error) {
      if (reservation) await releaseProgressPanelReservation(reservation).catch(() => void 0);
      stderr.write(`${errorMessage(error)}
`);
      return 1;
    }
  }
  const serviceFactory = options.createService ?? createTaskProgressService;
  let panelLease;
  try {
    if (parsed.instanceFile && parsed.instanceToken) {
      panelLease = await claimProgressPanel({
        filePath: parsed.instanceFile,
        token: parsed.instanceToken
      });
      if (!panelLease) return 0;
    }
    const service = await serviceFactory({
      initializeStateDirectory: false,
      ...parsed.stateDirectory === void 0 ? {} : { stateDirectory: parsed.stateDirectory }
    });
    const query = {
      workspaceRoot: parsed.workspaceRoot,
      ...parsed.taskId === void 0 ? {} : { taskId: parsed.taskId }
    };
    if (parsed.mode === "once") {
      const result = await service.getTaskProgress(query);
      if (!result.ok) {
        stderr.write(`${result.error.message}
`);
        return 1;
      }
      stdout.write(renderTaskProgressTerminal(result.snapshot, {
        interactive: false,
        color: false
      }));
      return 0;
    }
    const interactiveInput = stdin.isTTY === true;
    let initialSnapshot;
    let controller;
    let finish;
    let idleTimer;
    const finished = new Promise((resolveFinished) => {
      finish = resolveFinished;
    });
    const watcher = await watchTaskProgress({
      service,
      ...query,
      intervalMs: parsed.intervalMs,
      onSnapshot(snapshot) {
        if (idleTimer !== void 0) {
          clearTimeout(idleTimer);
          idleTimer = void 0;
        }
        if (parsed.idleTimeoutMs !== void 0 && snapshot.task.status === "completed") {
          idleTimer = setTimeout(() => finish?.(), parsed.idleTimeoutMs);
        }
        initialSnapshot = snapshot;
        if (controller !== void 0) controller.updateSnapshot(snapshot);
        else if (!interactiveInput) {
          stdout.write(renderTaskProgressTerminal(snapshot, {
            interactive: true,
            color: colorEnabled(parsed.color)
          }));
        }
      },
      onError(message) {
        if (controller !== void 0) controller.reportRefreshError(message);
        else stderr.write(`Progress refresh failed: ${message}
`);
      }
    });
    const stop = () => finish?.();
    try {
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      if (interactiveInput) {
        if (initialSnapshot === void 0) throw new Error("Task progress could not be read.");
        stdout.write("\x1B[?25l");
        controller = new TerminalController({
          input: stdin,
          service,
          workspaceRoot: parsed.workspaceRoot,
          snapshot: initialSnapshot,
          onRender(snapshot, view) {
            stdout.write(renderTaskProgressTerminal(snapshot, {
              interactive: true,
              color: colorEnabled(parsed.color),
              view
            }));
          },
          onExit: stop,
          ...parsed.taskId === void 0 ? {} : { taskId: parsed.taskId }
        });
        controller.start();
      }
      await finished;
      return 0;
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      if (idleTimer !== void 0) clearTimeout(idleTimer);
      watcher.stop();
      try {
        controller?.stop();
      } finally {
        if (interactiveInput) stdout.write("\x1B[?25h\n");
      }
    }
  } catch (error) {
    stderr.write(`${errorMessage(error)}
`);
    return 1;
  } finally {
    await panelLease?.release();
  }
}
var invokedPath = process.argv[1] === void 0 ? void 0 : resolve3(process.argv[1]);
if (invokedPath !== void 0 && invokedPath === fileURLToPath(import.meta.url)) {
  void runProgressCli({ argv: process.argv.slice(2) }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
export {
  runProgressCli
};
